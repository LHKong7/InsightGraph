import { resolve } from "path";
import { SqliteConnection } from "../sqlite/connection";
import { ensureSchema } from "../sqlite/schema";
import {
  mergeAliases,
  mergeDescription,
  prepareStatements,
  upsertEntity,
} from "../sqlite/writer";
import type { ImportStats, MergePolicy } from "../types";
import { DEFAULT_MERGE_POLICY } from "../types";

/**
 * Merge a source SQLite graph file into a target SQLite graph file. Uses
 * `ATTACH DATABASE` so both graphs can be joined inside a single transaction,
 * remapping entity/metric UUIDs when the target already has a row under the
 * same canonical key.
 *
 * Scenarios:
 *   - Two users/teams each build a graph locally; later a maintainer merges
 *     the two files into one authoritative DB.
 *   - Combining snapshot exports from CI / ETL pipelines.
 *
 * The target schema is ensured before the merge, so callers may pass a fresh
 * file path.
 */
export function mergeSqliteStore(
  targetPath: string,
  sourcePath: string,
  policy: MergePolicy = DEFAULT_MERGE_POLICY,
): ImportStats {
  const target = new SqliteConnection(targetPath);
  ensureSchema(target);
  const db = target.raw();
  const stmts = prepareStatements(db);

  const stats: ImportStats = { nodes: 0, edges: 0, conflicts: 0 };

  const srcPathAbs = sourcePath === ":memory:" ? sourcePath : resolve(sourcePath);
  db.prepare(`ATTACH DATABASE ? AS src`).run(srcPathAbs);

  const run = db.transaction(() => {
    // 1. Reports / Sections / Paragraphs / SourceSpans / MetricValues / Claims
    //    / TimePeriods are all UUID-keyed — INSERT OR IGNORE is safe.
    const uuidTables: Array<[string, string[]]> = [
      ["reports", ["report_id", "title", "source_filename", "date", "num_pages"]],
      ["sections", ["section_id", "title", "level", `"order"`]],
      ["paragraphs", ["paragraph_id", "text", "page"]],
      [
        "source_spans",
        ["span_id", "text", "page", "start_char", "end_char", "block_id"],
      ],
      ["metric_values", ["value_id", "value", "unit", "period"]],
      ["claims", ["claim_id", "text", "claim_type", "confidence"]],
      [
        "time_periods",
        ["period_id", "label", "start_date", "end_date"],
      ],
    ];
    for (const [table, cols] of uuidTables) {
      const colList = cols.join(", ");
      db.exec(
        `INSERT OR IGNORE INTO main.${table} (${colList})
         SELECT ${colList} FROM src.${table}`,
      );
      const row = db
        .prepare(`SELECT changes() AS n`)
        .get() as { n: number };
      stats.nodes += row.n;
    }

    // 2. Entities — logical merge on (canonical_name, entity_type).
    // We build a remap (src_entity_id → target_entity_id) so edges can be
    // rewritten to the target's canonical ids.
    const srcEntities = db
      .prepare(
        `SELECT entity_id, canonical_name, entity_type, name,
                description, aliases
           FROM src.entities`,
      )
      .all() as Array<{
      entity_id: string;
      canonical_name: string;
      entity_type: string;
      name: string | null;
      description: string | null;
      aliases: string | null;
    }>;

    db.exec(
      `CREATE TEMP TABLE IF NOT EXISTS _entity_remap(src_id TEXT PRIMARY KEY, tgt_id TEXT)`,
    );
    const remapInsert = db.prepare(
      `INSERT OR REPLACE INTO _entity_remap(src_id, tgt_id) VALUES (?, ?)`,
    );
    for (const row of srcEntities) {
      const aliases = row.aliases ? (JSON.parse(row.aliases) as string[]) : [];
      const existing = stmts.getEntityIdByCanon.get(
        row.canonical_name,
        row.entity_type,
      ) as
        | {
            entity_id: string;
            description: string | null;
            aliases: string | null;
          }
        | undefined;

      if (!existing) {
        // New row — insert with the source's id.
        db.prepare(
          `INSERT INTO entities
             (entity_id, canonical_name, entity_type, name, description, aliases)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          row.entity_id,
          row.canonical_name,
          row.entity_type,
          row.name ?? row.canonical_name,
          row.description,
          JSON.stringify(aliases),
        );
        remapInsert.run(row.entity_id, row.entity_id);
        stats.nodes++;
        continue;
      }

      // Conflict — apply policy.
      const existingAliases = existing.aliases
        ? (JSON.parse(existing.aliases) as string[])
        : [];
      const newDescription = mergeDescription(
        existing.description,
        row.description,
        policy.description,
      );
      const newAliases = mergeAliases(
        existingAliases,
        aliases,
        policy.aliases,
      );
      db.prepare(
        `UPDATE entities SET description = ?, aliases = ? WHERE entity_id = ?`,
      ).run(newDescription, JSON.stringify(newAliases), existing.entity_id);
      remapInsert.run(row.entity_id, existing.entity_id);
      stats.conflicts++;
      if (
        policy.conflictLog &&
        row.description != null &&
        existing.description != null &&
        existing.description !== row.description
      ) {
        stmts.logConflict.run(
          existing.entity_id,
          "description",
          existing.description,
          row.description,
        );
      }
    }

    // 3. Metrics — logical merge on (name).
    db.exec(
      `CREATE TEMP TABLE IF NOT EXISTS _metric_remap(src_id TEXT PRIMARY KEY, tgt_id TEXT)`,
    );
    const metricRemapInsert = db.prepare(
      `INSERT OR REPLACE INTO _metric_remap(src_id, tgt_id) VALUES (?, ?)`,
    );
    const srcMetrics = db
      .prepare(`SELECT metric_id, name, unit FROM src.metrics`)
      .all() as Array<{ metric_id: string; name: string; unit: string | null }>;
    for (const m of srcMetrics) {
      stmts.upsertMetricIgnore.run({
        metricId: m.metric_id,
        name: m.name,
        unit: m.unit,
      });
      const existing = stmts.getMetricIdByName.get(m.name) as
        | { metric_id: string }
        | undefined;
      metricRemapInsert.run(m.metric_id, existing?.metric_id ?? m.metric_id);
      stats.nodes++;
    }

    // 4. Edges — remap endpoints, upsert by (src,tgt,type).
    const edgeQuery = `
      SELECT
        COALESCE(er.tgt_id, mr.tgt_id, e.source_id) AS source_id,
        COALESCE(er2.tgt_id, mr2.tgt_id, e.target_id) AS target_id,
        e.type AS type,
        e.properties AS properties
      FROM src.edges e
      LEFT JOIN _entity_remap er  ON er.src_id  = e.source_id
      LEFT JOIN _metric_remap mr  ON mr.src_id  = e.source_id
      LEFT JOIN _entity_remap er2 ON er2.src_id = e.target_id
      LEFT JOIN _metric_remap mr2 ON mr2.src_id = e.target_id
    `;
    const edgeRows = db.prepare(edgeQuery).all() as Array<{
      source_id: string;
      target_id: string;
      type: string;
      properties: string | null;
    }>;
    const edgeStmt =
      policy.edgeProps === "overwrite"
        ? stmts.upsertEdgeOverwrite
        : stmts.upsertEdgePreferExisting;
    for (const e of edgeRows) {
      edgeStmt.run({
        sourceId: e.source_id,
        targetId: e.target_id,
        type: e.type,
        properties: e.properties,
      });
      stats.edges++;
    }

    // 5. Cleanup temp tables so repeat merges don't leak stale rows.
    db.exec(`DROP TABLE IF EXISTS _entity_remap`);
    db.exec(`DROP TABLE IF EXISTS _metric_remap`);

    // 6. Refresh FTS content (content-table inserts went through triggers, but
    // manual inserts into `entities` also bypass them when we went via direct
    // prepared statements; rebuild is idempotent.)
    try {
      db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
      db.exec(`INSERT INTO claims_fts(claims_fts) VALUES('rebuild')`);
    } catch {
      // older sqlite versions may not support rebuild
    }
  });

  try {
    run();
  } finally {
    db.prepare(`DETACH DATABASE src`).run();
    target.close();
  }

  // Suppress unused-import warning; upsertEntity is re-exported for callers
  // who want to merge individual entities outside the full-DB path.
  void upsertEntity;

  return stats;
}
