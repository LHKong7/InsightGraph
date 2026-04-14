import type { Ontology } from "@insightgraph/core";
import { Neo4jConnection, toPlainObject } from "./connection";
import { ensureSchema } from "./schema";
import { GraphReader } from "./reader";
import { GraphWriter } from "./writer";
import type {
  GraphDumpChunk,
  GraphStore,
  ImportStats,
  MergePolicy,
} from "../types";
import { DEFAULT_MERGE_POLICY } from "../types";

const TYPED_NODE_LABELS: Array<{ label: string; idKey: string }> = [
  { label: "Report", idKey: "report_id" },
  { label: "Section", idKey: "section_id" },
  { label: "Paragraph", idKey: "paragraph_id" },
  { label: "SourceSpan", idKey: "span_id" },
  { label: "Entity", idKey: "entity_id" },
  { label: "Metric", idKey: "metric_id" },
  { label: "MetricValue", idKey: "value_id" },
  { label: "Claim", idKey: "claim_id" },
  { label: "TimePeriod", idKey: "period_id" },
];

/**
 * Neo4j-backed GraphStore. Thin facade over the Neo4jConnection / Reader /
 * Writer classes. Does not change legacy behavior for callers that import
 * Neo4jConnection directly.
 */
export class Neo4jGraphStore implements GraphStore {
  readonly kind = "neo4j" as const;
  private conn: Neo4jConnection;

  constructor(uri: string, user: string, password: string) {
    this.conn = new Neo4jConnection(uri, user, password);
  }

  /** Escape hatch — apps that still need raw driver access (e.g. custom Cypher). */
  connection(): Neo4jConnection {
    return this.conn;
  }

  reader(): GraphReader {
    return new GraphReader(this.conn);
  }

  writer(): GraphWriter {
    return new GraphWriter(this.conn);
  }

  async ensureSchema(ontology?: Ontology): Promise<void> {
    await ensureSchema(this.conn, ontology);
  }

  async verifyConnectivity(): Promise<void> {
    await this.conn.verifyConnectivity();
  }

  async *exportDump(): AsyncIterable<GraphDumpChunk> {
    // Emit typed nodes first so the importer can resolve edge endpoints by id.
    for (const { label, idKey } of TYPED_NODE_LABELS) {
      const session = this.conn.session();
      try {
        const result = await session.run(
          `MATCH (n:\`${label}\`) RETURN properties(n) AS props`,
        );
        for (const record of result.records) {
          const props = toPlainObject(record.get("props")) as Record<
            string,
            unknown
          >;
          const id = props[idKey] as string | undefined;
          if (!id) continue;
          yield { kind: "node", label, id, props };
        }
      } finally {
        await session.close();
      }
    }

    // Emit edges. We key each edge by the matching endpoint id property.
    const session = this.conn.session();
    try {
      const result = await session.run(
        "MATCH (a)-[r]->(b) " +
          "RETURN type(r) AS type, properties(r) AS props, " +
          "       [a.report_id, a.section_id, a.paragraph_id, a.span_id, " +
          "        a.entity_id, a.metric_id, a.value_id, a.claim_id, a.period_id] AS aIds, " +
          "       [b.report_id, b.section_id, b.paragraph_id, b.span_id, " +
          "        b.entity_id, b.metric_id, b.value_id, b.claim_id, b.period_id] AS bIds",
      );
      for (const record of result.records) {
        const type = record.get("type") as string;
        const props = (toPlainObject(record.get("props")) ?? {}) as Record<
          string,
          unknown
        >;
        const aIds = record.get("aIds") as (string | null)[];
        const bIds = record.get("bIds") as (string | null)[];
        const sourceId = aIds.find((x) => x != null);
        const targetId = bIds.find((x) => x != null);
        if (!sourceId || !targetId) continue;
        yield { kind: "edge", type, sourceId, targetId, props };
      }
    } finally {
      await session.close();
    }
  }

  async importDump(
    dump: AsyncIterable<GraphDumpChunk>,
    policy: MergePolicy = DEFAULT_MERGE_POLICY,
  ): Promise<ImportStats> {
    const stats: ImportStats = { nodes: 0, edges: 0, conflicts: 0 };
    const session = this.conn.session();
    try {
      for await (const chunk of dump) {
        if (chunk.kind === "node") {
          const idKey = TYPED_NODE_LABELS.find(
            (t) => t.label === chunk.label,
          )?.idKey;
          if (!idKey) continue;
          // Use MERGE by id for UUID-keyed nodes; entities/metrics additionally
          // honor canonical_name/entity_type dedup through the writer path
          // (here we trust the exporter emitted canonical ids already).
          await session.run(
            `MERGE (n:\`${chunk.label}\` {${idKey}: $id}) SET n += $props`,
            { id: chunk.id, props: sanitizeProps(chunk.props) },
          );
          stats.nodes++;
          // policy-driven description/aliases merge for Entity
          if (chunk.label === "Entity") {
            await applyEntityPolicy(session, chunk.id, chunk.props, policy);
          }
        } else {
          await session.run(
            "MATCH (a) WHERE a.report_id=$sid OR a.section_id=$sid OR a.paragraph_id=$sid " +
              "  OR a.span_id=$sid OR a.entity_id=$sid OR a.metric_id=$sid " +
              "  OR a.value_id=$sid OR a.claim_id=$sid OR a.period_id=$sid " +
              "MATCH (b) WHERE b.report_id=$tid OR b.section_id=$tid OR b.paragraph_id=$tid " +
              "  OR b.span_id=$tid OR b.entity_id=$tid OR b.metric_id=$tid " +
              "  OR b.value_id=$tid OR b.claim_id=$tid OR b.period_id=$tid " +
              `MERGE (a)-[r:\`${chunk.type}\`]->(b) ` +
              "SET r += $props",
            { sid: chunk.sourceId, tid: chunk.targetId, props: chunk.props },
          );
          stats.edges++;
        }
      }
    } finally {
      await session.close();
    }
    return stats;
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}

function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

async function applyEntityPolicy(
  // Typed loosely to avoid a direct dep on neo4j-driver's Session type here.
  session: { run: (q: string, p?: Record<string, unknown>) => Promise<unknown> },
  entityId: string,
  props: Record<string, unknown>,
  policy: MergePolicy,
): Promise<void> {
  const incomingDesc = (props.description as string | null | undefined) ?? null;
  const incomingAliases = (props.aliases as unknown[] | undefined) ?? [];

  const descClause = {
    preferExisting:
      "e.description = CASE WHEN e.description IS NULL OR e.description = '' THEN $desc ELSE e.description END",
    overwrite: "e.description = $desc",
    concat:
      "e.description = CASE WHEN e.description IS NULL OR e.description = '' THEN $desc " +
      "                    WHEN $desc IS NULL THEN e.description " +
      "                    ELSE e.description + ' | ' + $desc END",
  }[policy.description];

  const aliasClause = {
    union:
      "e.aliases = [x IN coalesce(e.aliases, []) + $aliases WHERE x IS NOT NULL]",
    preferExisting:
      "e.aliases = CASE WHEN size(coalesce(e.aliases, [])) > 0 THEN e.aliases ELSE $aliases END",
    overwrite: "e.aliases = $aliases",
  }[policy.aliases];

  await session.run(
    `MATCH (e:Entity {entity_id: $entityId}) SET ${descClause}, ${aliasClause}`,
    { entityId, desc: incomingDesc, aliases: incomingAliases },
  );
}
