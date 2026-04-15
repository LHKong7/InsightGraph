import type { Ontology } from "@insightgraph/core";
import type {
  GraphDumpChunk,
  GraphStore,
  ImportStats,
  MergePolicy,
} from "../types";
import { DEFAULT_MERGE_POLICY } from "../types";
import { SqliteConnection } from "./connection";
import { ensureSchema as ensureSchemaSql } from "./schema";
import { SqliteGraphReader } from "./reader";
import { SqliteGraphWriter, upsertEntity, prepareStatements } from "./writer";

const TYPED_NODE_LABELS: Array<{ label: string; idKey: string; table: string }> = [
  { label: "Report", idKey: "report_id", table: "reports" },
  { label: "Section", idKey: "section_id", table: "sections" },
  { label: "Paragraph", idKey: "paragraph_id", table: "paragraphs" },
  { label: "SourceSpan", idKey: "span_id", table: "source_spans" },
  { label: "Entity", idKey: "entity_id", table: "entities" },
  { label: "Metric", idKey: "metric_id", table: "metrics" },
  { label: "MetricValue", idKey: "value_id", table: "metric_values" },
  { label: "Claim", idKey: "claim_id", table: "claims" },
  { label: "TimePeriod", idKey: "period_id", table: "time_periods" },
];

/**
 * Whitelist of valid table names, used to guard any `SELECT * FROM ${table}`
 * pattern against future refactors that might funnel user input into it.
 */
const TYPED_TABLE_SET = new Set(TYPED_NODE_LABELS.map((t) => t.table));

/**
 * SQLite-backed GraphStore. Opens a single database file via better-sqlite3
 * (sync driver wrapped in Promise.resolve on the async boundary to match the
 * GraphStore interface).
 */
export class SqliteGraphStore implements GraphStore {
  readonly kind = "sqlite" as const;
  private conn: SqliteConnection;

  constructor(path: string) {
    this.conn = new SqliteConnection(path);
  }

  /** Escape hatch for advanced use cases (migration tooling, tests). */
  connection(): SqliteConnection {
    return this.conn;
  }

  reader(): SqliteGraphReader {
    return new SqliteGraphReader(this.conn);
  }

  writer(): SqliteGraphWriter {
    return new SqliteGraphWriter(this.conn);
  }

  async ensureSchema(_ontology?: Ontology): Promise<void> {
    ensureSchemaSql(this.conn);
  }

  async verifyConnectivity(): Promise<void> {
    await this.conn.verifyConnectivity();
  }

  async *exportDump(): AsyncIterable<GraphDumpChunk> {
    const db = this.conn.raw();
    for (const { label, idKey, table } of TYPED_NODE_LABELS) {
      // Defensive: every table in TYPED_NODE_LABELS is hard-coded, but if a
      // future refactor ever derives `table` from user input, we would be
      // wide open to SQL injection via `SELECT * FROM ${table}`. Fail loud.
      if (!TYPED_TABLE_SET.has(table)) {
        throw new Error(`[sqlite-store] refusing to query unknown table: ${table}`);
      }
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<
        string,
        unknown
      >[];
      for (const row of rows) {
        const id = row[idKey] as string | undefined;
        if (!id) continue;
        const props = { ...row };
        // Parse JSON aliases back to array before emitting.
        if (label === "Entity" && typeof props.aliases === "string") {
          try {
            const parsed = JSON.parse(props.aliases as string);
            props.aliases = Array.isArray(parsed) ? parsed : [];
          } catch (err) {
            console.warn(
              `[sqlite-store] failed to parse aliases for entity ${id}: ${
                (err as Error).message
              }. Exporting as empty array.`,
            );
            props.aliases = [];
          }
        }
        yield { kind: "node", label, id, props };
      }
    }

    const edges = db
      .prepare(`SELECT source_id, target_id, type, properties FROM edges`)
      .all() as Array<{
      source_id: string;
      target_id: string;
      type: string;
      properties: string | null;
    }>;
    for (const e of edges) {
      yield {
        kind: "edge",
        type: e.type,
        sourceId: e.source_id,
        targetId: e.target_id,
        props: e.properties ? JSON.parse(e.properties) : {},
      };
    }
  }

  async importDump(
    dump: AsyncIterable<GraphDumpChunk>,
    policy: MergePolicy = DEFAULT_MERGE_POLICY,
  ): Promise<ImportStats> {
    const db = this.conn.raw();
    const stmts = prepareStatements(db);
    const stats: ImportStats = { nodes: 0, edges: 0, conflicts: 0 };

    // Remap table for entities/metrics — their logical identity keys
    // (canonical_name+entity_type / name) may map the incoming UUID to a
    // different already-existing UUID in the target graph.
    const entityRemap = new Map<string, string>();
    const metricRemap = new Map<string, string>();

    for await (const chunk of dump) {
      if (chunk.kind === "node") {
        const def = TYPED_NODE_LABELS.find((t) => t.label === chunk.label);
        if (!def) continue;

        if (chunk.label === "Entity") {
          const props = chunk.props;
          const canonical = (props.canonical_name as string) ?? (props.name as string);
          const entityType = (props.entity_type as string) ?? "OTHER";
          const description = (props.description as string | null) ?? null;
          const aliases =
            (Array.isArray(props.aliases) ? props.aliases : []) as string[];
          const resolvedId = upsertEntity(
            db,
            stmts,
            policy,
            canonical,
            entityType,
            description,
            aliases,
          );
          entityRemap.set(chunk.id, resolvedId);
          stats.nodes++;
        } else if (chunk.label === "Metric") {
          const name = chunk.props.name as string;
          const unit = (chunk.props.unit as string | null) ?? null;
          stmts.upsertMetricIgnore.run({
            metricId: chunk.id,
            name,
            unit,
          });
          const existing = stmts.getMetricIdByName.get(name) as
            | { metric_id: string }
            | undefined;
          metricRemap.set(chunk.id, existing?.metric_id ?? chunk.id);
          stats.nodes++;
        } else {
          // UUID-keyed nodes: INSERT OR IGNORE; first-writer wins.
          insertOrIgnoreTyped(db, def.table, def.idKey, chunk.id, chunk.props);
          stats.nodes++;
        }
      } else {
        const sourceId = remap(chunk.sourceId, entityRemap, metricRemap);
        const targetId = remap(chunk.targetId, entityRemap, metricRemap);
        const propsJson = chunk.props ? JSON.stringify(chunk.props) : null;
        const stmt =
          policy.edgeProps === "overwrite"
            ? stmts.upsertEdgeOverwrite
            : stmts.upsertEdgePreferExisting;
        stmt.run({
          sourceId,
          targetId,
          type: chunk.type,
          properties: propsJson,
        });
        stats.edges++;
      }
    }

    // Rebuild FTS after a bulk import. Cheap enough given typical graph sizes
    // and ensures `bm25` ranking stays sane.
    try {
      db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
      db.exec(`INSERT INTO claims_fts(claims_fts) VALUES('rebuild')`);
    } catch {
      // older sqlite versions may not support rebuild; triggers already keep it fresh
    }

    return stats;
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}

function remap(
  id: string,
  entityRemap: Map<string, string>,
  metricRemap: Map<string, string>,
): string {
  return entityRemap.get(id) ?? metricRemap.get(id) ?? id;
}

function insertOrIgnoreTyped(
  db: import("better-sqlite3").Database,
  table: string,
  idKey: string,
  id: string,
  props: Record<string, unknown>,
): void {
  // Introspect the target columns so we don't try to insert keys that don't
  // exist on this specific table (exporter may include extra fields).
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).map((r) => r.name);
  const row: Record<string, unknown> = {};
  for (const col of cols) {
    if (col === idKey) {
      row[col] = id;
    } else if (col in props) {
      row[col] = props[col];
    } else {
      row[col] = null;
    }
  }
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  db.prepare(
    `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`,
  ).run(row);
}
