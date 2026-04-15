import { randomUUID } from "crypto";
import type { ManagedTransaction } from "neo4j-driver";
import type {
  DocumentIR,
  SectionNode,
  ExtractionResult,
  ResolvedEntity,
  TableBlock,
} from "@insightgraph/core";
import { Neo4jConnection } from "./connection";
import type { GraphWriter as IGraphWriter, MergePolicy } from "../types";

export const REL_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class GraphWriter implements IGraphWriter {
  constructor(private conn: Neo4jConnection) {}

  async writeDocument(
    doc: DocumentIR,
    extractions: ExtractionResult,
    // Neo4j backend's MERGE semantics already implement the DEFAULT_MERGE_POLICY
    // behavior. The policy argument is accepted for interface compatibility;
    // non-default policies are only honored by the SQLite writer today.
    _policy?: MergePolicy,
  ): Promise<Record<string, number>> {
    const session = this.conn.session();
    try {
      const result = await session.executeWrite((tx) =>
        writeAll(tx, doc, extractions),
      );
      return result;
    } finally {
      await session.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Batched writer
//
// The original writer issued a separate `await tx.run()` for every node and
// edge — on a 500-entity document this was 1500+ serial round-trips inside
// one transaction. This version pre-computes arrays of rows and uses `UNWIND`
// to push each category in a single round-trip, which takes per-document
// write time from seconds to tens of milliseconds for most inputs while
// preserving exact MERGE semantics.
// ---------------------------------------------------------------------------

interface SectionRow {
  sectionId: string;
  parentSectionId: string | null;
  title: string | null;
  level: number;
  order: number;
}

interface ParagraphRow {
  paraId: string;
  sectionId: string;
  text: string;
  page: number;
  spanId: string;
  spanText: string;
  startChar: number;
  endChar: number;
}

interface EntityRow {
  canonicalName: string;
  entityType: string;
  entityId: string;
  name: string;
  description: string | null;
  aliases: string[];
}

interface MetricRow {
  name: string;
  metricId: string;
  unit: string | null;
}

interface MetricValueRow {
  valueId: string;
  value: number;
  unit: string | null;
  period: string | null;
  metricName: string;
  entityCanonicalName: string | null;
  entityType: string | null;
  paraId: string | null;
}

interface ClaimRow {
  claimId: string;
  text: string;
  claimType: string;
  confidence: number;
  paraId: string | null;
  aboutEntity: { canonicalName: string; entityType: string } | null;
  mentionsEntities: Array<{ canonicalName: string; entityType: string }>;
}

interface RelationshipRow {
  sourceName: string;
  targetName: string;
  description: string;
  confidence: number;
  sourceText: string;
}

async function writeAll(
  tx: ManagedTransaction,
  doc: DocumentIR,
  extractions: ExtractionResult,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    reports: 0, sections: 0, paragraphs: 0, source_spans: 0,
    entities: 0, metrics: 0, metric_values: 0, claims: 0,
    relationships: 0, edges: 0,
  };

  const reportId = doc.id;

  // --- 1. Report ----------------------------------------------------------
  await tx.run(
    "MERGE (r:Report {report_id: $reportId}) " +
    "SET r.title = $title, r.source_filename = $sourceFilename, " +
    "    r.date = $date, r.num_pages = $numPages",
    {
      reportId,
      title: doc.title ?? doc.sourceFilename,
      sourceFilename: doc.sourceFilename,
      date: doc.date ?? null,
      numPages: doc.numPages,
    },
  );
  counts.reports++;

  // --- 2. Flatten sections + paragraphs ------------------------------------
  const sectionRows: SectionRow[] = [];
  const paragraphRows: ParagraphRow[] = [];
  const blockIdMap = new Map<string, string>(); // block.id -> paragraph_id

  function walk(section: SectionNode, parentSectionId: string | null) {
    sectionRows.push({
      sectionId: section.id,
      parentSectionId,
      title: section.title ?? null,
      level: section.level,
      order: section.order,
    });
    for (const block of section.blocks) {
      const paraId = block.id;
      blockIdMap.set(block.id, paraId);
      let text = block.content;
      const tb = block as TableBlock;
      if (tb.type === "table" && tb.caption) {
        text = `${tb.caption}\n${text}`;
      }
      paragraphRows.push({
        paraId,
        sectionId: section.id,
        text,
        page: block.sourceSpan.page,
        spanId: randomUUID(),
        spanText: block.sourceSpan.text,
        startChar: block.sourceSpan.startChar,
        endChar: block.sourceSpan.endChar,
      });
    }
    for (const child of section.children) walk(child, section.id);
  }
  for (const root of doc.sections) walk(root, null);

  // --- 3. Batched section writes ------------------------------------------
  if (sectionRows.length > 0) {
    await tx.run(
      "UNWIND $rows AS row " +
      "MERGE (s:Section {section_id: row.sectionId}) " +
      "SET s.title = row.title, s.level = row.level, s.order = row.order",
      { rows: sectionRows },
    );

    // section -> report (for roots) OR section -> parent (for children)
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.parentSectionId IS NULL " +
      "MATCH (r:Report {report_id: $reportId}) " +
      "MATCH (s:Section {section_id: row.sectionId}) " +
      "MERGE (r)-[:HAS_SECTION]->(s)",
      { rows: sectionRows, reportId },
    );
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.parentSectionId IS NOT NULL " +
      "MATCH (p:Section {section_id: row.parentSectionId}) " +
      "MATCH (s:Section {section_id: row.sectionId}) " +
      "MERGE (p)-[:HAS_SECTION]->(s)",
      { rows: sectionRows },
    );
    counts.sections = sectionRows.length;
    counts.edges += sectionRows.length; // one HAS_SECTION per section
  }

  // --- 4. Batched paragraphs + spans + edges ------------------------------
  if (paragraphRows.length > 0) {
    await tx.run(
      "UNWIND $rows AS row " +
      "MERGE (p:Paragraph {paragraph_id: row.paraId}) " +
      "SET p.text = row.text, p.page = row.page",
      { rows: paragraphRows },
    );
    await tx.run(
      "UNWIND $rows AS row " +
      "MATCH (s:Section {section_id: row.sectionId}) " +
      "MATCH (p:Paragraph {paragraph_id: row.paraId}) " +
      "MERGE (s)-[:HAS_PARAGRAPH]->(p)",
      { rows: paragraphRows },
    );
    await tx.run(
      "UNWIND $rows AS row " +
      "MERGE (sp:SourceSpan {span_id: row.spanId}) " +
      "SET sp.text = row.spanText, sp.page = row.page, " +
      "    sp.start_char = row.startChar, sp.end_char = row.endChar, " +
      "    sp.block_id = row.paraId",
      { rows: paragraphRows },
    );
    await tx.run(
      "UNWIND $rows AS row " +
      "MATCH (p:Paragraph {paragraph_id: row.paraId}) " +
      "MATCH (sp:SourceSpan {span_id: row.spanId}) " +
      "MERGE (p)-[:HAS_SPAN]->(sp)",
      { rows: paragraphRows },
    );
    counts.paragraphs = paragraphRows.length;
    counts.source_spans = paragraphRows.length;
    counts.edges += paragraphRows.length * 2; // HAS_PARAGRAPH + HAS_SPAN
  }

  // --- 5. Resolved-entity lookup ------------------------------------------
  const resolvedMap = new Map<string, ResolvedEntity>();
  for (const resolved of extractions.resolvedEntities) {
    resolvedMap.set(resolved.canonicalName.toLowerCase(), resolved);
    for (const alias of resolved.aliases) {
      resolvedMap.set(alias.toLowerCase(), resolved);
    }
  }

  // --- 6. Batched entity writes -------------------------------------------
  const entityRows: EntityRow[] = [];
  const entityNodeMap = new Map<string, string>();

  const collectEntity = (
    canonical: string,
    entityType: string,
    description: string | null,
    aliases: string[],
  ) => {
    const canonLower = canonical.toLowerCase();
    if (entityNodeMap.has(canonLower)) return;
    const entityId = randomUUID();
    entityNodeMap.set(canonLower, entityId);
    entityRows.push({
      canonicalName: canonical,
      entityType,
      entityId,
      name: canonical,
      description,
      aliases,
    });
  };

  for (const entity of extractions.entities) {
    const resolved = resolvedMap.get(entity.name.toLowerCase());
    collectEntity(
      resolved ? resolved.canonicalName : entity.name,
      resolved ? resolved.type : entity.type,
      (resolved ? resolved.description : entity.description) ?? null,
      resolved ? resolved.aliases : [],
    );
  }
  // Resolved entities that weren't in the raw list (e.g. aliased-only).
  for (const resolved of extractions.resolvedEntities) {
    collectEntity(
      resolved.canonicalName,
      resolved.type,
      resolved.description ?? null,
      resolved.aliases,
    );
  }

  if (entityRows.length > 0) {
    // MERGE each entity (keyed on canonical+type). Preserves the exact
    // ON CREATE / ON MATCH semantics of the per-row implementation.
    await tx.run(
      "UNWIND $rows AS row " +
      "MERGE (e:Entity {canonical_name: row.canonicalName, entity_type: row.entityType}) " +
      "ON CREATE SET e.entity_id = row.entityId, e.name = row.name, " +
      "              e.description = row.description, e.aliases = row.aliases " +
      "ON MATCH SET e.description = CASE " +
      "  WHEN e.description IS NULL THEN row.description ELSE e.description END, " +
      "  e.aliases = CASE " +
      "  WHEN size(row.aliases) > size(coalesce(e.aliases, [])) THEN row.aliases ELSE e.aliases END",
      { rows: entityRows },
    );
    // Entity -> Report (SOURCED_FROM)
    await tx.run(
      "UNWIND $rows AS row " +
      "MATCH (e:Entity {canonical_name: row.canonicalName, entity_type: row.entityType}) " +
      "MATCH (r:Report {report_id: $reportId}) " +
      "MERGE (e)-[:SOURCED_FROM]->(r)",
      { rows: entityRows, reportId },
    );
    counts.entities = entityRows.length;
    counts.edges += entityRows.length;
  }

  // --- 7. Batched metrics + metric values ---------------------------------
  const metricSeen = new Map<string, MetricRow>();
  const metricValueRows: MetricValueRow[] = [];

  for (const metric of extractions.metrics) {
    const metricLower = metric.name.toLowerCase();
    if (!metricSeen.has(metricLower)) {
      metricSeen.set(metricLower, {
        name: metric.name,
        metricId: randomUUID(),
        unit: metric.unit ?? null,
      });
    }
    let entityCanonical: string | null = null;
    let entityType: string | null = null;
    if (metric.entityName) {
      const resolved = resolvedMap.get(metric.entityName.toLowerCase());
      entityCanonical = resolved ? resolved.canonicalName : metric.entityName;
      entityType = resolved ? resolved.type : "OTHER";
    }
    metricValueRows.push({
      valueId: randomUUID(),
      value: metric.value,
      unit: metric.unit ?? null,
      period: metric.period ?? null,
      metricName: metric.name,
      entityCanonicalName: entityCanonical,
      entityType,
      paraId:
        metric.sourceBlockId && blockIdMap.has(metric.sourceBlockId)
          ? blockIdMap.get(metric.sourceBlockId)!
          : null,
    });
  }

  const metricRows = [...metricSeen.values()];
  if (metricRows.length > 0) {
    await tx.run(
      "UNWIND $rows AS row " +
      "MERGE (m:Metric {name: row.name}) " +
      "ON CREATE SET m.metric_id = row.metricId, m.unit = row.unit",
      { rows: metricRows },
    );
    counts.metrics = metricRows.length;
  }

  if (metricValueRows.length > 0) {
    await tx.run(
      "UNWIND $rows AS row " +
      "CREATE (mv:MetricValue { " +
      "  value_id: row.valueId, value: row.value, " +
      "  unit: row.unit, period: row.period " +
      "})",
      { rows: metricValueRows },
    );
    // MetricValue -> Metric
    await tx.run(
      "UNWIND $rows AS row " +
      "MATCH (mv:MetricValue {value_id: row.valueId}) " +
      "MATCH (m:Metric {name: row.metricName}) " +
      "MERGE (mv)-[:MEASURES]->(m)",
      { rows: metricValueRows },
    );
    // Entity -> MetricValue (when an entity is attached)
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.entityCanonicalName IS NOT NULL " +
      "MATCH (e:Entity {canonical_name: row.entityCanonicalName, entity_type: row.entityType}) " +
      "MATCH (mv:MetricValue {value_id: row.valueId}) " +
      "MERGE (e)-[:HAS_VALUE]->(mv)",
      { rows: metricValueRows },
    );
    // MetricValue -> SourceSpan (when a source block is attached)
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.paraId IS NOT NULL " +
      "MATCH (mv:MetricValue {value_id: row.valueId}) " +
      "MATCH (p:Paragraph {paragraph_id: row.paraId}) " +
      "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) " +
      "MERGE (mv)-[:SUPPORTED_BY]->(sp)",
      { rows: metricValueRows },
    );
    counts.metric_values = metricValueRows.length;
    counts.edges += metricValueRows.length; // MEASURES always
    counts.edges += metricValueRows.filter((r) => r.entityCanonicalName).length;
    counts.edges += metricValueRows.filter((r) => r.paraId).length;
  }

  // --- 8. Batched claims --------------------------------------------------
  const claimRows: ClaimRow[] = [];
  for (const claim of extractions.claims) {
    const paraId =
      claim.sourceBlockId && blockIdMap.has(claim.sourceBlockId)
        ? blockIdMap.get(claim.sourceBlockId)!
        : null;
    const aboutEntity =
      claim.entitiesMentioned.length > 0
        ? resolveEntityRef(claim.entitiesMentioned[0], resolvedMap)
        : null;
    const mentionsEntities = claim.entitiesMentioned
      .slice(1)
      .map((n) => resolveEntityRef(n, resolvedMap));
    claimRows.push({
      claimId: randomUUID(),
      text: claim.text,
      claimType: claim.type,
      confidence: claim.confidence,
      paraId,
      aboutEntity,
      mentionsEntities,
    });
  }

  if (claimRows.length > 0) {
    await tx.run(
      "UNWIND $rows AS row " +
      "CREATE (c:Claim { " +
      "  claim_id: row.claimId, text: row.text, " +
      "  claim_type: row.claimType, confidence: row.confidence " +
      "})",
      { rows: claimRows },
    );
    // Paragraph -> Claim (ASSERTS)
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.paraId IS NOT NULL " +
      "MATCH (p:Paragraph {paragraph_id: row.paraId}) " +
      "MATCH (c:Claim {claim_id: row.claimId}) " +
      "MERGE (p)-[:ASSERTS]->(c)",
      { rows: claimRows },
    );
    // Claim -> SourceSpan
    await tx.run(
      "UNWIND $rows AS row " +
      "WITH row WHERE row.paraId IS NOT NULL " +
      "MATCH (c:Claim {claim_id: row.claimId}) " +
      "MATCH (p:Paragraph {paragraph_id: row.paraId}) " +
      "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) " +
      "MERGE (c)-[:SUPPORTED_BY]->(sp)",
      { rows: claimRows },
    );
    // Claim -> Entity (ABOUT — primary mentioned entity)
    const aboutRows = claimRows
      .filter((r) => r.aboutEntity)
      .map((r) => ({
        claimId: r.claimId,
        canonicalName: r.aboutEntity!.canonicalName,
        entityType: r.aboutEntity!.entityType,
      }));
    if (aboutRows.length > 0) {
      await tx.run(
        "UNWIND $rows AS row " +
        "MATCH (c:Claim {claim_id: row.claimId}) " +
        "MATCH (e:Entity {canonical_name: row.canonicalName, entity_type: row.entityType}) " +
        "MERGE (c)-[:ABOUT]->(e)",
        { rows: aboutRows },
      );
    }
    // Claim -> Entity (MENTIONS — secondary entities)
    const mentionsRows: Array<{
      claimId: string;
      canonicalName: string;
      entityType: string;
    }> = [];
    for (const r of claimRows) {
      for (const m of r.mentionsEntities) {
        mentionsRows.push({
          claimId: r.claimId,
          canonicalName: m.canonicalName,
          entityType: m.entityType,
        });
      }
    }
    if (mentionsRows.length > 0) {
      await tx.run(
        "UNWIND $rows AS row " +
        "MATCH (c:Claim {claim_id: row.claimId}) " +
        "MATCH (e:Entity {canonical_name: row.canonicalName, entity_type: row.entityType}) " +
        "MERGE (c)-[:MENTIONS]->(e)",
        { rows: mentionsRows },
      );
    }

    counts.claims = claimRows.length;
    counts.edges += claimRows.filter((r) => r.paraId).length * 2; // ASSERTS + SUPPORTED_BY
    counts.edges += aboutRows.length;
    counts.edges += mentionsRows.length;
  }

  // --- 9. Batched entity-entity relationships (by type) -------------------
  // Relationship types are dynamic (stored as edge label), so we bucket by
  // type and issue one UNWIND per unique type.
  const relsByType = new Map<string, RelationshipRow[]>();
  for (const rel of extractions.relationships) {
    const relType = rel.relationshipType.trim().toUpperCase().replace(/ /g, "_");
    if (!REL_TYPE_PATTERN.test(relType)) continue;
    const sourceResolved = resolvedMap.get(rel.sourceEntity.toLowerCase());
    const targetResolved = resolvedMap.get(rel.targetEntity.toLowerCase());
    const row: RelationshipRow = {
      sourceName: sourceResolved ? sourceResolved.canonicalName : rel.sourceEntity,
      targetName: targetResolved ? targetResolved.canonicalName : rel.targetEntity,
      description: rel.description,
      confidence: rel.confidence,
      sourceText: rel.sourceText,
    };
    if (!relsByType.has(relType)) relsByType.set(relType, []);
    relsByType.get(relType)!.push(row);
  }

  for (const [relType, rows] of relsByType) {
    await tx.run(
      // relType is validated against REL_TYPE_PATTERN above so the string
      // interpolation is safe.
      "UNWIND $rows AS row " +
      "MATCH (source:Entity) " +
      "WHERE source.canonical_name = row.sourceName OR source.name = row.sourceName " +
      "MATCH (target:Entity) " +
      "WHERE target.canonical_name = row.targetName OR target.name = row.targetName " +
      `MERGE (source)-[r:${relType}]->(target) ` +
      "SET r.description = row.description, r.confidence = row.confidence, r.source_text = row.sourceText",
      { rows },
    );
    counts.relationships += rows.length;
    counts.edges += rows.length;
  }

  return counts;
}

function resolveEntityRef(
  name: string,
  resolvedMap: Map<string, ResolvedEntity>,
): { canonicalName: string; entityType: string } {
  const resolved = resolvedMap.get(name.toLowerCase());
  return {
    canonicalName: resolved ? resolved.canonicalName : name,
    entityType: resolved ? resolved.type : "OTHER",
  };
}
