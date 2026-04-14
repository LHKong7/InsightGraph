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

  // --- Report ---
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

  // --- Sections & blocks ---
  const blockIdMap = new Map<string, string>();

  async function writeSection(section: SectionNode, parentId: string | null) {
    const sectionId = section.id;
    await tx.run(
      "MERGE (s:Section {section_id: $sectionId}) " +
      "SET s.title = $title, s.level = $level, s.order = $order",
      { sectionId, title: section.title ?? null, level: section.level, order: section.order },
    );
    counts.sections++;

    if (parentId === null) {
      await tx.run(
        "MATCH (r:Report {report_id: $reportId}) " +
        "MATCH (s:Section {section_id: $sectionId}) " +
        "MERGE (r)-[:HAS_SECTION]->(s)",
        { reportId, sectionId },
      );
    } else {
      await tx.run(
        "MATCH (p:Section {section_id: $parentId}) " +
        "MATCH (s:Section {section_id: $sectionId}) " +
        "MERGE (p)-[:HAS_SECTION]->(s)",
        { parentId, sectionId },
      );
    }
    counts.edges++;

    for (const block of section.blocks) {
      const paraId = block.id;
      blockIdMap.set(block.id, paraId);

      let text = block.content;
      const tb = block as TableBlock;
      if (tb.type === "table" && tb.caption) {
        text = `${tb.caption}\n${text}`;
      }

      await tx.run(
        "MERGE (p:Paragraph {paragraph_id: $paraId}) SET p.text = $text, p.page = $page",
        { paraId, text, page: block.sourceSpan.page },
      );
      counts.paragraphs++;

      await tx.run(
        "MATCH (s:Section {section_id: $sectionId}) " +
        "MATCH (p:Paragraph {paragraph_id: $paraId}) " +
        "MERGE (s)-[:HAS_PARAGRAPH]->(p)",
        { sectionId, paraId },
      );
      counts.edges++;

      const spanId = randomUUID();
      await tx.run(
        "MERGE (sp:SourceSpan {span_id: $spanId}) " +
        "SET sp.text = $text, sp.page = $page, " +
        "    sp.start_char = $startChar, sp.end_char = $endChar, " +
        "    sp.block_id = $blockId",
        {
          spanId,
          text: block.sourceSpan.text,
          page: block.sourceSpan.page,
          startChar: block.sourceSpan.startChar,
          endChar: block.sourceSpan.endChar,
          blockId: paraId,
        },
      );
      counts.source_spans++;

      await tx.run(
        "MATCH (p:Paragraph {paragraph_id: $paraId}) " +
        "MATCH (sp:SourceSpan {span_id: $spanId}) " +
        "MERGE (p)-[:HAS_SPAN]->(sp)",
        { paraId, spanId },
      );
      counts.edges++;
    }

    for (const child of section.children) {
      await writeSection(child, sectionId);
    }
  }

  for (const section of doc.sections) {
    await writeSection(section, null);
  }

  // --- Resolved entity lookup ---
  const resolvedMap = new Map<string, ResolvedEntity>();
  for (const resolved of extractions.resolvedEntities) {
    resolvedMap.set(resolved.canonicalName.toLowerCase(), resolved);
    for (const alias of resolved.aliases) {
      resolvedMap.set(alias.toLowerCase(), resolved);
    }
  }

  // --- Entities ---
  const entityNodeMap = new Map<string, string>();

  for (const entity of extractions.entities) {
    const resolved = resolvedMap.get(entity.name.toLowerCase());
    const canonical = resolved ? resolved.canonicalName : entity.name;
    const description = resolved ? resolved.description : entity.description;
    const aliases = resolved ? resolved.aliases : [];
    const entityType = resolved ? resolved.type : entity.type;
    const canonLower = canonical.toLowerCase();

    if (entityNodeMap.has(canonLower)) continue;

    const entityId = randomUUID();
    entityNodeMap.set(canonLower, entityId);

    await tx.run(
      "MERGE (e:Entity {canonical_name: $canonicalName, entity_type: $entityType}) " +
      "ON CREATE SET e.entity_id = $entityId, e.name = $name, " +
      "              e.description = $description, e.aliases = $aliases " +
      "ON MATCH SET e.description = CASE " +
      "  WHEN e.description IS NULL THEN $description ELSE e.description END, " +
      "  e.aliases = CASE " +
      "  WHEN size($aliases) > size(coalesce(e.aliases, [])) THEN $aliases ELSE e.aliases END",
      { canonicalName: canonical, entityType, entityId, name: canonical, description: description ?? null, aliases },
    );
    counts.entities++;

    await tx.run(
      "MATCH (e:Entity {canonical_name: $canonicalName, entity_type: $entityType}) " +
      "MATCH (r:Report {report_id: $reportId}) " +
      "MERGE (e)-[:SOURCED_FROM]->(r)",
      { canonicalName: canonical, entityType, reportId },
    );
    counts.edges++;
  }

  // Ensure resolved entities not in raw list are present
  for (const resolved of extractions.resolvedEntities) {
    const canonLower = resolved.canonicalName.toLowerCase();
    if (entityNodeMap.has(canonLower)) continue;
    const entityId = randomUUID();
    entityNodeMap.set(canonLower, entityId);
    await tx.run(
      "MERGE (e:Entity {canonical_name: $canonicalName, entity_type: $entityType}) " +
      "ON CREATE SET e.entity_id = $entityId, e.name = $name, " +
      "              e.description = $description, e.aliases = $aliases",
      {
        canonicalName: resolved.canonicalName,
        entityType: resolved.type,
        entityId,
        name: resolved.canonicalName,
        description: resolved.description ?? null,
        aliases: resolved.aliases,
      },
    );
    counts.entities++;
  }

  // --- Metrics & MetricValues ---
  const metricNameMap = new Map<string, string>();

  for (const metric of extractions.metrics) {
    const metricLower = metric.name.toLowerCase();

    if (!metricNameMap.has(metricLower)) {
      const metricId = randomUUID();
      metricNameMap.set(metricLower, metricId);
      await tx.run(
        "MERGE (m:Metric {name: $name}) ON CREATE SET m.metric_id = $metricId, m.unit = $unit",
        { name: metric.name, metricId, unit: metric.unit ?? null },
      );
      counts.metrics++;
    }

    const valueId = randomUUID();
    await tx.run(
      "CREATE (mv:MetricValue {value_id: $valueId, value: $value, unit: $unit, period: $period})",
      { valueId, value: metric.value, unit: metric.unit ?? null, period: metric.period ?? null },
    );
    counts.metric_values++;

    await tx.run(
      "MATCH (mv:MetricValue {value_id: $valueId}) " +
      "MATCH (m:Metric {name: $metricName}) " +
      "MERGE (mv)-[:MEASURES]->(m)",
      { valueId, metricName: metric.name },
    );
    counts.edges++;

    if (metric.entityName) {
      const resolved = resolvedMap.get(metric.entityName.toLowerCase());
      const canonical = resolved ? resolved.canonicalName : metric.entityName;
      const entityType = resolved ? resolved.type : "OTHER";
      await tx.run(
        "MATCH (e:Entity {canonical_name: $canonicalName, entity_type: $entityType}) " +
        "MATCH (mv:MetricValue {value_id: $valueId}) " +
        "MERGE (e)-[:HAS_VALUE]->(mv)",
        { canonicalName: canonical, entityType, valueId },
      );
      counts.edges++;
    }

    if (metric.sourceBlockId && blockIdMap.has(metric.sourceBlockId)) {
      const paraId = blockIdMap.get(metric.sourceBlockId)!;
      await tx.run(
        "MATCH (mv:MetricValue {value_id: $valueId}) " +
        "MATCH (p:Paragraph {paragraph_id: $paraId}) " +
        "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) " +
        "MERGE (mv)-[:SUPPORTED_BY]->(sp)",
        { valueId, paraId },
      );
      counts.edges++;
    }
  }

  // --- Claims ---
  for (const claim of extractions.claims) {
    const claimId = randomUUID();
    await tx.run(
      "CREATE (c:Claim {claim_id: $claimId, text: $text, claim_type: $claimType, confidence: $confidence})",
      { claimId, text: claim.text, claimType: claim.type, confidence: claim.confidence },
    );
    counts.claims++;

    if (claim.sourceBlockId && blockIdMap.has(claim.sourceBlockId)) {
      const paraId = blockIdMap.get(claim.sourceBlockId)!;
      await tx.run(
        "MATCH (p:Paragraph {paragraph_id: $paraId}) " +
        "MATCH (c:Claim {claim_id: $claimId}) " +
        "MERGE (p)-[:ASSERTS]->(c)",
        { paraId, claimId },
      );
      counts.edges++;

      await tx.run(
        "MATCH (c:Claim {claim_id: $claimId}) " +
        "MATCH (p:Paragraph {paragraph_id: $paraId}) " +
        "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) " +
        "MERGE (c)-[:SUPPORTED_BY]->(sp)",
        { claimId, paraId },
      );
      counts.edges++;
    }

    for (let i = 0; i < claim.entitiesMentioned.length; i++) {
      const entityName = claim.entitiesMentioned[i];
      const resolved = resolvedMap.get(entityName.toLowerCase());
      const canonical = resolved ? resolved.canonicalName : entityName;
      const entityType = resolved ? resolved.type : "OTHER";
      const edgeType = i === 0 ? "ABOUT" : "MENTIONS";

      await tx.run(
        `MATCH (c:Claim {claim_id: $claimId}) ` +
        `MATCH (e:Entity {canonical_name: $canonicalName, entity_type: $entityType}) ` +
        `MERGE (c)-[:${edgeType}]->(e)`,
        { claimId, canonicalName: canonical, entityType },
      );
      counts.edges++;
    }
  }

  // --- Relationships ---
  for (const rel of extractions.relationships) {
    const relType = rel.relationshipType.trim().toUpperCase().replace(/ /g, "_");
    if (!REL_TYPE_PATTERN.test(relType)) continue;

    const sourceResolved = resolvedMap.get(rel.sourceEntity.toLowerCase());
    const sourceCanonical = sourceResolved ? sourceResolved.canonicalName : rel.sourceEntity;
    const targetResolved = resolvedMap.get(rel.targetEntity.toLowerCase());
    const targetCanonical = targetResolved ? targetResolved.canonicalName : rel.targetEntity;

    await tx.run(
      `MATCH (source:Entity) WHERE source.canonical_name = $sourceName OR source.name = $sourceName ` +
      `MATCH (target:Entity) WHERE target.canonical_name = $targetName OR target.name = $targetName ` +
      `MERGE (source)-[r:${relType}]->(target) ` +
      `SET r.description = $description, r.confidence = $confidence, r.source_text = $sourceText`,
      {
        sourceName: sourceCanonical,
        targetName: targetCanonical,
        description: rel.description,
        confidence: rel.confidence,
        sourceText: rel.sourceText,
      },
    );
    counts.relationships++;
    counts.edges++;
  }

  return counts;
}
