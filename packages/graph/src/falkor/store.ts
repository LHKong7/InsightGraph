import type { Ontology } from "@insightgraph/core";
import { FalkorConnection } from "./connection";
import { ensureSchema as ensureSchemaFalkor } from "./schema";
import { FalkorGraphReader } from "./reader";
import { FalkorGraphWriter } from "./writer";
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
 * Embedded FalkorDB graph store. Speaks OpenCypher, so the reader/writer
 * classes port cleanly from the Neo4j equivalents. Zero-config: `falkordblite`
 * manages the redis-server binary download and child-process lifecycle.
 */
export class FalkorGraphStore implements GraphStore {
  readonly kind = "falkor" as const;
  private conn: FalkorConnection;

  constructor(path: string, graphName = "insightgraph") {
    this.conn = new FalkorConnection(path, graphName);
  }

  connection(): FalkorConnection {
    return this.conn;
  }

  reader(): FalkorGraphReader {
    return new FalkorGraphReader(this.conn);
  }

  writer(): FalkorGraphWriter {
    return new FalkorGraphWriter(this.conn);
  }

  async ensureSchema(ontology?: Ontology): Promise<void> {
    await ensureSchemaFalkor(this.conn, ontology);
  }

  async verifyConnectivity(): Promise<void> {
    await this.conn.verifyConnectivity();
  }

  async *exportDump(): AsyncIterable<GraphDumpChunk> {
    await this.conn.open();

    for (const { label, idKey } of TYPED_NODE_LABELS) {
      const result = await this.conn.query<{ props: Record<string, unknown> }>(
        `MATCH (n:\`${label}\`) RETURN properties(n) AS props`,
      );
      for (const row of result.data ?? []) {
        const props = row.props;
        const id = props[idKey] as string | undefined;
        if (!id) continue;
        yield { kind: "node", label, id, props };
      }
    }

    const edgeResult = await this.conn.query<{
      type: string;
      props: Record<string, unknown>;
      aProps: Record<string, unknown>;
      bProps: Record<string, unknown>;
    }>(
      "MATCH (a)-[r]->(b) " +
        "RETURN type(r) AS type, properties(r) AS props, " +
        "       properties(a) AS aProps, properties(b) AS bProps",
    );
    for (const row of edgeResult.data ?? []) {
      const sourceId = extractNodeId(row.aProps);
      const targetId = extractNodeId(row.bProps);
      if (!sourceId || !targetId) continue;
      yield {
        kind: "edge",
        type: row.type,
        sourceId,
        targetId,
        props: row.props ?? {},
      };
    }
  }

  async importDump(
    dump: AsyncIterable<GraphDumpChunk>,
    policy: MergePolicy = DEFAULT_MERGE_POLICY,
  ): Promise<ImportStats> {
    await this.conn.open();
    const stats: ImportStats = { nodes: 0, edges: 0, conflicts: 0 };

    for await (const chunk of dump) {
      if (chunk.kind === "node") {
        const idKey = TYPED_NODE_LABELS.find(
          (t) => t.label === chunk.label,
        )?.idKey;
        if (!idKey) continue;
        await this.conn.query(
          `MERGE (n:\`${chunk.label}\` {${idKey}: $id}) SET n += $props`,
          { id: chunk.id, props: chunk.props },
        );
        stats.nodes++;
        if (chunk.label === "Entity") {
          await applyEntityPolicy(this.conn, chunk.id, chunk.props, policy);
        }
      } else {
        await this.conn.query(
          "MATCH (a) WHERE a.report_id=$sid OR a.section_id=$sid OR a.paragraph_id=$sid " +
            "  OR a.span_id=$sid OR a.entity_id=$sid OR a.metric_id=$sid " +
            "  OR a.value_id=$sid OR a.claim_id=$sid OR a.period_id=$sid " +
            "MATCH (b) WHERE b.report_id=$tid OR b.section_id=$tid OR b.paragraph_id=$tid " +
            "  OR b.span_id=$tid OR b.entity_id=$tid OR b.metric_id=$tid " +
            "  OR b.value_id=$tid OR b.claim_id=$tid OR b.period_id=$tid " +
            `MERGE (a)-[r:\`${chunk.type}\`]->(b) ` +
            "SET r += $props",
          {
            sid: chunk.sourceId,
            tid: chunk.targetId,
            props: chunk.props,
          },
        );
        stats.edges++;
      }
    }
    return stats;
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}

function extractNodeId(props: Record<string, unknown>): string | undefined {
  for (const key of [
    "report_id",
    "section_id",
    "paragraph_id",
    "span_id",
    "entity_id",
    "metric_id",
    "value_id",
    "claim_id",
    "period_id",
  ]) {
    const val = props[key];
    if (typeof val === "string") return val;
  }
  return undefined;
}

async function applyEntityPolicy(
  conn: FalkorConnection,
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

  await conn.query(
    `MATCH (e:Entity {entity_id: $entityId}) SET ${descClause}, ${aliasClause}`,
    { entityId, desc: incomingDesc, aliases: incomingAliases },
  );
}
