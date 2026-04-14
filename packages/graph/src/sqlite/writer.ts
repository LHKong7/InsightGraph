import { randomUUID } from "crypto";
import type {
  DocumentIR,
  ExtractionResult,
  ResolvedEntity,
  SectionNode,
  TableBlock,
} from "@insightgraph/core";
import type { Database, Statement } from "better-sqlite3";
import type { GraphWriter as IGraphWriter, MergePolicy } from "../types";
import { DEFAULT_MERGE_POLICY } from "../types";
import type { SqliteConnection } from "./connection";

export const REL_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * SQLite graph writer. Replicates the semantics of the Neo4j GraphWriter
 * (packages/graph/src/neo4j/writer.ts) using typed tables + a generic edges
 * table, inside a single transaction per document (matching the
 * session.executeWrite() guarantee on the Neo4j side).
 *
 * Merge semantics for entities follow the Cypher ON MATCH logic at
 * neo4j/writer.ts:178-181 (description: preferExisting; aliases: larger set
 * wins). This is the default policy; alternative policies are honored when
 * passed explicitly (e.g. by the importer / sqlite-merger).
 */
export class SqliteGraphWriter implements IGraphWriter {
  constructor(private conn: SqliteConnection) {}

  async writeDocument(
    doc: DocumentIR,
    extractions: ExtractionResult,
    policy: MergePolicy = DEFAULT_MERGE_POLICY,
  ): Promise<Record<string, number>> {
    const db = this.conn.raw();
    const stmts = prepareStatements(db);

    const run = db.transaction(() => writeAll(db, stmts, doc, extractions, policy));
    return run();
  }
}

// -- Prepared statements ------------------------------------------------------

export interface Stmts {
  upsertReport: Statement;
  upsertSection: Statement;
  upsertParagraph: Statement;
  upsertSpan: Statement;
  insertMetricValue: Statement;
  insertClaim: Statement;
  upsertEdgePreferExisting: Statement;
  upsertEdgeOverwrite: Statement;
  upsertMetricIgnore: Statement;
  getMetricIdByName: Statement;
  getEntityIdByCanon: Statement;
  getEntityIdByName: Statement;
  getParagraphSpan: Statement;
  logConflict: Statement;
}

function prepareStatements(db: Database): Stmts {
  return {
    upsertReport: db.prepare(
      `INSERT INTO reports (report_id, title, source_filename, date, num_pages)
       VALUES (@reportId, @title, @sourceFilename, @date, @numPages)
       ON CONFLICT(report_id) DO UPDATE SET
         title = excluded.title,
         source_filename = excluded.source_filename,
         date = excluded.date,
         num_pages = excluded.num_pages`,
    ),
    upsertSection: db.prepare(
      `INSERT INTO sections (section_id, title, level, "order")
       VALUES (@sectionId, @title, @level, @order)
       ON CONFLICT(section_id) DO UPDATE SET
         title = excluded.title,
         level = excluded.level,
         "order" = excluded."order"`,
    ),
    upsertParagraph: db.prepare(
      `INSERT INTO paragraphs (paragraph_id, text, page)
       VALUES (@paraId, @text, @page)
       ON CONFLICT(paragraph_id) DO UPDATE SET
         text = excluded.text,
         page = excluded.page`,
    ),
    upsertSpan: db.prepare(
      `INSERT INTO source_spans (span_id, text, page, start_char, end_char, block_id)
       VALUES (@spanId, @text, @page, @startChar, @endChar, @blockId)
       ON CONFLICT(span_id) DO UPDATE SET
         text = excluded.text,
         page = excluded.page,
         start_char = excluded.start_char,
         end_char = excluded.end_char,
         block_id = excluded.block_id`,
    ),
    insertMetricValue: db.prepare(
      `INSERT INTO metric_values (value_id, value, unit, period)
       VALUES (@valueId, @value, @unit, @period)`,
    ),
    insertClaim: db.prepare(
      `INSERT INTO claims (claim_id, text, claim_type, confidence)
       VALUES (@claimId, @text, @claimType, @confidence)`,
    ),
    // Edges: ON CONFLICT by (source,target,type). We merge JSON properties by
    // preferring existing non-null values (matching edgeProps=preferExisting
    // in DEFAULT_MERGE_POLICY). The writer also offers an overwrite variant
    // via `upsertEdgeOverwrite` — callers choose based on policy.
    upsertEdgePreferExisting: db.prepare(
      `INSERT INTO edges (source_id, target_id, type, properties)
       VALUES (@sourceId, @targetId, @type, @properties)
       ON CONFLICT(source_id, target_id, type) DO UPDATE SET
         properties = COALESCE(edges.properties, excluded.properties)`,
    ),
    upsertEdgeOverwrite: db.prepare(
      `INSERT INTO edges (source_id, target_id, type, properties)
       VALUES (@sourceId, @targetId, @type, @properties)
       ON CONFLICT(source_id, target_id, type) DO UPDATE SET
         properties = excluded.properties`,
    ),
    upsertMetricIgnore: db.prepare(
      `INSERT INTO metrics (metric_id, name, unit)
       VALUES (@metricId, @name, @unit)
       ON CONFLICT(name) DO NOTHING`,
    ),
    getMetricIdByName: db.prepare(
      `SELECT metric_id FROM metrics WHERE name = ?`,
    ),
    getEntityIdByCanon: db.prepare(
      `SELECT entity_id, description, aliases
         FROM entities
        WHERE canonical_name = ? AND entity_type = ?`,
    ),
    getEntityIdByName: db.prepare(
      `SELECT entity_id, canonical_name, entity_type
         FROM entities
        WHERE canonical_name = ? OR name = ?
        LIMIT 1`,
    ),
    getParagraphSpan: db.prepare(
      `SELECT e.target_id AS span_id
         FROM edges e
        WHERE e.source_id = ? AND e.type = 'HAS_SPAN'
        LIMIT 1`,
    ),
    logConflict: db.prepare(
      `INSERT INTO conflicts (entity_id, field, old_value, new_value)
       VALUES (?, ?, ?, ?)`,
    ),
  };
}

// -- Main write ---------------------------------------------------------------

function writeAll(
  db: Database,
  stmts: Stmts,
  doc: DocumentIR,
  extractions: ExtractionResult,
  policy: MergePolicy,
): Record<string, number> {
  const counts: Record<string, number> = {
    reports: 0,
    sections: 0,
    paragraphs: 0,
    source_spans: 0,
    entities: 0,
    metrics: 0,
    metric_values: 0,
    claims: 0,
    relationships: 0,
    edges: 0,
  };

  const reportId = doc.id;

  // --- Report ---
  stmts.upsertReport.run({
    reportId,
    title: doc.title ?? doc.sourceFilename,
    sourceFilename: doc.sourceFilename,
    date: doc.date ?? null,
    numPages: doc.numPages,
  });
  counts.reports++;

  // --- Sections & blocks ---
  const blockIdMap = new Map<string, string>();

  const writeSection = (section: SectionNode, parentId: string | null): void => {
    const sectionId = section.id;
    stmts.upsertSection.run({
      sectionId,
      title: section.title ?? null,
      level: section.level,
      order: section.order,
    });
    counts.sections++;

    addEdge(
      stmts,
      counts,
      policy,
      parentId === null ? reportId : parentId,
      sectionId,
      "HAS_SECTION",
      null,
    );

    for (const block of section.blocks) {
      const paraId = block.id;
      blockIdMap.set(block.id, paraId);

      let text = block.content;
      const tb = block as TableBlock;
      if (tb.type === "table" && tb.caption) {
        text = `${tb.caption}\n${text}`;
      }

      stmts.upsertParagraph.run({
        paraId,
        text,
        page: block.sourceSpan.page,
      });
      counts.paragraphs++;

      addEdge(stmts, counts, policy, sectionId, paraId, "HAS_PARAGRAPH", null);

      const spanId = randomUUID();
      stmts.upsertSpan.run({
        spanId,
        text: block.sourceSpan.text,
        page: block.sourceSpan.page,
        startChar: block.sourceSpan.startChar,
        endChar: block.sourceSpan.endChar,
        blockId: paraId,
      });
      counts.source_spans++;

      addEdge(stmts, counts, policy, paraId, spanId, "HAS_SPAN", null);
    }

    for (const child of section.children) {
      writeSection(child, sectionId);
    }
  };

  for (const section of doc.sections) {
    writeSection(section, null);
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
  const entityNodeMap = new Map<string, string>(); // canonLower → entity_id

  for (const entity of extractions.entities) {
    const resolved = resolvedMap.get(entity.name.toLowerCase());
    const canonical = resolved ? resolved.canonicalName : entity.name;
    const description = resolved ? resolved.description : entity.description;
    const aliases = resolved ? resolved.aliases : [];
    const entityType = resolved ? resolved.type : entity.type;
    const canonLower = canonical.toLowerCase();

    if (entityNodeMap.has(canonLower)) continue;

    const entityId = upsertEntity(
      db,
      stmts,
      policy,
      canonical,
      entityType,
      description ?? null,
      aliases,
    );
    entityNodeMap.set(canonLower, entityId);
    counts.entities++;

    addEdge(stmts, counts, policy, entityId, reportId, "SOURCED_FROM", null);
  }

  // Ensure resolved entities not in raw list are present
  for (const resolved of extractions.resolvedEntities) {
    const canonLower = resolved.canonicalName.toLowerCase();
    if (entityNodeMap.has(canonLower)) continue;
    const entityId = upsertEntity(
      db,
      stmts,
      policy,
      resolved.canonicalName,
      resolved.type,
      resolved.description ?? null,
      resolved.aliases,
    );
    entityNodeMap.set(canonLower, entityId);
    counts.entities++;
  }

  // --- Metrics & MetricValues ---
  const metricIdMap = new Map<string, string>();

  for (const metric of extractions.metrics) {
    const metricLower = metric.name.toLowerCase();

    let metricId = metricIdMap.get(metricLower);
    if (!metricId) {
      const newMetricId = randomUUID();
      stmts.upsertMetricIgnore.run({
        metricId: newMetricId,
        name: metric.name,
        unit: metric.unit ?? null,
      });
      const row = stmts.getMetricIdByName.get(metric.name) as
        | { metric_id: string }
        | undefined;
      metricId = row?.metric_id ?? newMetricId;
      metricIdMap.set(metricLower, metricId);
      counts.metrics++;
    }

    const valueId = randomUUID();
    stmts.insertMetricValue.run({
      valueId,
      value: metric.value,
      unit: metric.unit ?? null,
      period: metric.period ?? null,
    });
    counts.metric_values++;

    addEdge(stmts, counts, policy, valueId, metricId, "MEASURES", null);

    if (metric.entityName) {
      const resolved = resolvedMap.get(metric.entityName.toLowerCase());
      const canonical = resolved ? resolved.canonicalName : metric.entityName;
      const entityType = resolved ? resolved.type : "OTHER";
      const row = stmts.getEntityIdByCanon.get(canonical, entityType) as
        | { entity_id: string }
        | undefined;
      if (row) {
        addEdge(stmts, counts, policy, row.entity_id, valueId, "HAS_VALUE", null);
      }
    }

    if (metric.sourceBlockId && blockIdMap.has(metric.sourceBlockId)) {
      const paraId = blockIdMap.get(metric.sourceBlockId)!;
      const spanRow = stmts.getParagraphSpan.get(paraId) as
        | { span_id: string }
        | undefined;
      if (spanRow) {
        addEdge(
          stmts,
          counts,
          policy,
          valueId,
          spanRow.span_id,
          "SUPPORTED_BY",
          null,
        );
      }
    }
  }

  // --- Claims ---
  for (const claim of extractions.claims) {
    const claimId = randomUUID();
    stmts.insertClaim.run({
      claimId,
      text: claim.text,
      claimType: claim.type,
      confidence: claim.confidence,
    });
    counts.claims++;

    if (claim.sourceBlockId && blockIdMap.has(claim.sourceBlockId)) {
      const paraId = blockIdMap.get(claim.sourceBlockId)!;
      addEdge(stmts, counts, policy, paraId, claimId, "ASSERTS", null);

      const spanRow = stmts.getParagraphSpan.get(paraId) as
        | { span_id: string }
        | undefined;
      if (spanRow) {
        addEdge(
          stmts,
          counts,
          policy,
          claimId,
          spanRow.span_id,
          "SUPPORTED_BY",
          null,
        );
      }
    }

    for (let i = 0; i < claim.entitiesMentioned.length; i++) {
      const entityName = claim.entitiesMentioned[i];
      const resolved = resolvedMap.get(entityName.toLowerCase());
      const canonical = resolved ? resolved.canonicalName : entityName;
      const entityType = resolved ? resolved.type : "OTHER";
      const edgeType = i === 0 ? "ABOUT" : "MENTIONS";

      const row = stmts.getEntityIdByCanon.get(canonical, entityType) as
        | { entity_id: string }
        | undefined;
      if (row) {
        addEdge(stmts, counts, policy, claimId, row.entity_id, edgeType, null);
      }
    }
  }

  // --- Relationships (entity↔entity) ---
  for (const rel of extractions.relationships) {
    const relType = rel.relationshipType.trim().toUpperCase().replace(/ /g, "_");
    if (!REL_TYPE_PATTERN.test(relType)) continue;

    const sourceResolved = resolvedMap.get(rel.sourceEntity.toLowerCase());
    const sourceCanonical = sourceResolved
      ? sourceResolved.canonicalName
      : rel.sourceEntity;
    const targetResolved = resolvedMap.get(rel.targetEntity.toLowerCase());
    const targetCanonical = targetResolved
      ? targetResolved.canonicalName
      : rel.targetEntity;

    const src = stmts.getEntityIdByName.get(sourceCanonical, sourceCanonical) as
      | { entity_id: string }
      | undefined;
    const tgt = stmts.getEntityIdByName.get(targetCanonical, targetCanonical) as
      | { entity_id: string }
      | undefined;
    if (!src || !tgt) continue;

    addEdge(stmts, counts, policy, src.entity_id, tgt.entity_id, relType, {
      description: rel.description,
      confidence: rel.confidence,
      source_text: rel.sourceText,
    });
    counts.relationships++;
  }

  return counts;
}

// -- Helpers ------------------------------------------------------------------

function addEdge(
  stmts: Stmts,
  counts: Record<string, number>,
  policy: MergePolicy,
  sourceId: string,
  targetId: string,
  type: string,
  properties: Record<string, unknown> | null,
): void {
  const stmt =
    policy.edgeProps === "overwrite"
      ? stmts.upsertEdgeOverwrite
      : stmts.upsertEdgePreferExisting;
  stmt.run({
    sourceId,
    targetId,
    type,
    properties: properties ? JSON.stringify(properties) : null,
  });
  counts.edges++;
}

/**
 * Upsert an Entity following the Neo4j MERGE semantics at
 * packages/graph/src/neo4j/writer.ts:174-183, parameterized by MergePolicy.
 *
 * Returns the resolved entity_id (either newly created or the existing one).
 */
export function upsertEntity(
  db: Database,
  stmts: Stmts,
  policy: MergePolicy,
  canonical: string,
  entityType: string,
  description: string | null,
  aliases: string[],
): string {
  const existing = stmts.getEntityIdByCanon.get(canonical, entityType) as
    | { entity_id: string; description: string | null; aliases: string | null }
    | undefined;

  if (!existing) {
    const entityId = randomUUID();
    db.prepare(
      `INSERT INTO entities
         (entity_id, canonical_name, entity_type, name, description, aliases)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      entityId,
      canonical,
      entityType,
      canonical,
      description,
      JSON.stringify(aliases ?? []),
    );
    return entityId;
  }

  // Merge into existing row per policy.
  const existingAliases = existing.aliases ? (JSON.parse(existing.aliases) as string[]) : [];
  const newDescription = mergeDescription(existing.description, description, policy.description);
  const newAliases = mergeAliases(existingAliases, aliases ?? [], policy.aliases);

  db.prepare(
    `UPDATE entities SET description = ?, aliases = ? WHERE entity_id = ?`,
  ).run(newDescription, JSON.stringify(newAliases), existing.entity_id);

  if (
    policy.conflictLog &&
    description != null &&
    existing.description != null &&
    existing.description !== description
  ) {
    stmts.logConflict.run(
      existing.entity_id,
      "description",
      existing.description,
      description,
    );
  }

  return existing.entity_id;
}

export function mergeDescription(
  existing: string | null,
  incoming: string | null,
  mode: MergePolicy["description"],
): string | null {
  if (mode === "overwrite") return incoming ?? existing;
  if (mode === "preferExisting") {
    if (existing && existing.trim() !== "") return existing;
    return incoming;
  }
  // concat
  if (!existing) return incoming;
  if (!incoming || incoming === existing) return existing;
  return `${existing} | ${incoming}`;
}

export function mergeAliases(
  existing: string[],
  incoming: string[],
  mode: MergePolicy["aliases"],
): string[] {
  if (mode === "overwrite") return incoming;
  if (mode === "preferExisting") {
    return existing.length > 0 ? existing : incoming;
  }
  // union (deduped, stable order: existing first)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of existing.concat(incoming)) {
    if (v == null) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// Re-export prepareStatements for reuse by sqlite-merger.
export { prepareStatements };
