import type { FalkorConnection } from "./connection";
import type { GraphReader as IGraphReader } from "../types";

/**
 * FalkorDB reader. Ports packages/graph/src/neo4j/reader.ts with two small
 * adjustments:
 *
 *   1. FalkorDB has no `elementId()` — we use `ID()` (returns an integer) and
 *      stringify for output-shape parity with the Neo4j reader.
 *
 *   2. Fulltext search uses `CALL db.idx.fulltext.queryNodes('<Label>', $q)`
 *      with the *label* as the index name, whereas Neo4j's `entity_search`
 *      index has a distinct name.
 *
 * The typed result of `conn.query()` is
 *   `{ data: Array<Record<string, unknown>>, metadata: string[] }`
 * where each row is an object keyed by the RETURN column names, and
 * node/edge values are parsed to `{ id, labels, properties }` /
 * `{ id, relationshipType, sourceId, destinationId, properties }`.
 */
export class FalkorGraphReader implements IGraphReader {
  constructor(private conn: FalkorConnection) {}

  // --- Entity queries --------------------------------------------------------

  async findEntities(
    name?: string,
    entityType?: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    await this.conn.open();
    const cap = Math.max(1, Math.trunc(limit));
    if (name) {
      let query =
        "CALL db.idx.fulltext.queryNodes('Entity', $query) YIELD node, score ";
      if (entityType) query += "WHERE node.entity_type = $entityType ";
      query +=
        "RETURN properties(node) AS entity, score ORDER BY score DESC LIMIT $limit";
      const params: Record<string, unknown> = { query: name, limit: cap };
      if (entityType) params.entityType = entityType;
      const result = await this.conn.query<Record<string, unknown>>(
        query,
        params,
      );
      return (result.data ?? []) as Record<string, unknown>[];
    }

    let query = "MATCH (node:Entity) ";
    const params: Record<string, unknown> = { limit: cap };
    if (entityType) {
      query += "WHERE node.entity_type = $entityType ";
      params.entityType = entityType;
    }
    query += "RETURN properties(node) AS entity LIMIT $limit";
    const result = await this.conn.query<Record<string, unknown>>(
      query,
      params,
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async getEntity(entityId: string): Promise<Record<string, unknown> | null> {
    const result = await this.conn.query<{ entity: Record<string, unknown> }>(
      "MATCH (e:Entity {entity_id: $entityId}) RETURN properties(e) AS entity",
      { entityId },
    );
    const row = result.data?.[0];
    return row?.entity ?? null;
  }

  // --- Claim queries ---------------------------------------------------------

  async getClaimsAbout(entityName: string): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (e:Entity)<-[:MENTIONS|ABOUT]-(c:Claim) " +
        "WHERE e.canonical_name = $entityName OR e.name = $entityName " +
        "RETURN properties(c) AS claim, properties(e) AS entity",
      { entityName },
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async findEvidenceForClaim(
    claimId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (c:Claim {claim_id: $claimId})-[:SUPPORTED_BY]->(s:SourceSpan) " +
        "RETURN properties(s) AS span",
      { claimId },
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  // --- Metric queries --------------------------------------------------------

  async getEntityMetrics(
    entityName: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "WHERE e.canonical_name = $entityName OR e.name = $entityName " +
        "RETURN properties(mv) AS metric_value, properties(m) AS metric, " +
        "       properties(e) AS entity ORDER BY m.name, mv.period",
      { entityName },
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async getMetricHistory(
    metricName: string,
    entityName?: string,
  ): Promise<Record<string, unknown>[]> {
    if (entityName) {
      const result = await this.conn.query<Record<string, unknown>>(
        "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
          "WHERE m.name = $metricName " +
          "  AND (e.canonical_name = $entityName OR e.name = $entityName) " +
          "RETURN properties(mv) AS metric_value, properties(m) AS metric, " +
          "       properties(e) AS entity ORDER BY mv.period",
        { metricName, entityName },
      );
      return (result.data ?? []) as Record<string, unknown>[];
    }
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "WHERE m.name = $metricName " +
        "RETURN properties(mv) AS metric_value, properties(m) AS metric " +
        "ORDER BY mv.period",
      { metricName },
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  // --- Subgraph --------------------------------------------------------------

  async getSubgraph(
    nodeId: string,
    depth = 2,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    const d = Math.max(1, Math.min(depth, 5));
    const result = await this.conn.query<{
      nodes: unknown[];
      edges: unknown[];
    }>(
      "MATCH (start) " +
        "WHERE start.entity_id = $nodeId OR start.report_id = $nodeId " +
        "   OR start.section_id = $nodeId OR start.paragraph_id = $nodeId " +
        "   OR start.claim_id = $nodeId OR start.metric_id = $nodeId " +
        "   OR start.value_id = $nodeId OR start.span_id = $nodeId " +
        "WITH start " +
        `MATCH path = (start)-[*1..${d}]-(neighbour) ` +
        "UNWIND relationships(path) AS rel " +
        "UNWIND nodes(path) AS n " +
        "WITH collect(DISTINCT {id: ID(n), labels: labels(n), " +
        "             props: properties(n)}) AS nodes, " +
        "     collect(DISTINCT {id: ID(rel), type: type(rel), " +
        "             startId: ID(startNode(rel)), " +
        "             endId: ID(endNode(rel)), " +
        "             props: properties(rel)}) AS edges " +
        "RETURN nodes, edges",
      { nodeId },
    );
    const row = result.data?.[0];
    if (!row) return { nodes: [], edges: [] };
    return {
      nodes: stringifyIds(row.nodes),
      edges: stringifyIds(row.edges),
    };
  }

  // --- Report queries --------------------------------------------------------

  async getReport(reportId: string): Promise<Record<string, unknown> | null> {
    const result = await this.conn.query<{ report: Record<string, unknown> }>(
      "MATCH (r:Report {report_id: $reportId}) RETURN properties(r) AS report",
      { reportId },
    );
    return result.data?.[0]?.report ?? null;
  }

  async listReports(): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (r:Report) RETURN properties(r) AS report ORDER BY r.date DESC",
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  // --- Relationship queries --------------------------------------------------

  async getEntityRelationships(
    entityName: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (e:Entity)-[r]-(other:Entity) " +
        "WHERE e.canonical_name = $name OR e.name = $name " +
        "RETURN type(r) AS relationship_type, properties(r) AS relationship_props, " +
        "       properties(other) AS related_entity, " +
        "       CASE WHEN startNode(r) = e THEN 'outgoing' ELSE 'incoming' END AS direction",
      { name: entityName },
    );
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async findPath(
    entityA: string,
    entityB: string,
    maxDepth = 4,
  ): Promise<{ nodes: unknown[]; edges: unknown[]; found: boolean }> {
    const d = Math.max(1, Math.min(maxDepth, 10));
    const result = await this.conn.query<{
      nodes: unknown[];
      edges: unknown[];
    }>(
      "MATCH (a:Entity), (b:Entity) " +
        "WHERE (a.canonical_name = $nameA OR a.name = $nameA) " +
        "  AND (b.canonical_name = $nameB OR b.name = $nameB) " +
        `MATCH path = shortestPath((a)-[*1..${d}]-(b)) ` +
        "UNWIND nodes(path) AS n " +
        "UNWIND relationships(path) AS rel " +
        "WITH collect(DISTINCT {labels: labels(n), props: properties(n)}) AS nodes, " +
        "     collect(DISTINCT {type: type(rel), props: properties(rel)}) AS edges " +
        "RETURN nodes, edges",
      { nameA: entityA, nameB: entityB },
    );
    const row = result.data?.[0];
    if (!row) return { nodes: [], edges: [], found: false };
    return { nodes: row.nodes, edges: row.edges, found: true };
  }

  async getEntityFullProfile(
    entityName: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (e:Entity) " +
        "WHERE e.canonical_name = $name OR e.name = $name " +
        "OPTIONAL MATCH (e)<-[:MENTIONS|ABOUT]-(c:Claim) " +
        "OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(span:SourceSpan) " +
        "OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "OPTIONAL MATCH (e)-[rel]-(other:Entity) " +
        "OPTIONAL MATCH (e)-[:SOURCED_FROM]->(r:Report) " +
        "WITH e, " +
        "  collect(DISTINCT {claim_id: c.claim_id, text: c.text, " +
        "    type: c.claim_type, confidence: c.confidence}) AS claims, " +
        "  collect(DISTINCT {text: span.text, page: span.page}) AS evidence, " +
        "  collect(DISTINCT {value: mv.value, unit: mv.unit, " +
        "    period: mv.period, metric_name: m.name}) AS metrics, " +
        "  collect(DISTINCT {name: other.canonical_name, type: other.entity_type, " +
        "    relationship: type(rel)}) AS related_entities, " +
        "  collect(DISTINCT {report_id: r.report_id, title: r.title}) AS reports " +
        "RETURN properties(e) AS entity, claims, evidence, metrics, related_entities, reports",
      { name: entityName },
    );
    const row = result.data?.[0];
    if (!row) return {};
    const filterNulls = (arr: Record<string, unknown>[], key: string) =>
      (arr ?? []).filter((item) => item[key] != null);
    return {
      entity: row.entity,
      claims: filterNulls(row.claims as Record<string, unknown>[], "claim_id"),
      evidence: filterNulls(row.evidence as Record<string, unknown>[], "text"),
      metrics: filterNulls(
        row.metrics as Record<string, unknown>[],
        "metric_name",
      ),
      related_entities: filterNulls(
        row.related_entities as Record<string, unknown>[],
        "name",
      ),
      reports: filterNulls(
        row.reports as Record<string, unknown>[],
        "report_id",
      ),
    };
  }

  async getCrossReportEntity(
    entityName: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.conn.query<Record<string, unknown>>(
      "MATCH (e:Entity)-[:SOURCED_FROM]->(r:Report) " +
        "WHERE e.canonical_name = $name OR e.name = $name " +
        "OPTIONAL MATCH (e)<-[:MENTIONS|ABOUT]-(c:Claim)-[:SUPPORTED_BY]->(span:SourceSpan) " +
        "OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "WITH r, e, " +
        "  collect(DISTINCT {text: c.text, type: c.claim_type, page: span.page}) AS claims, " +
        "  collect(DISTINCT {value: mv.value, unit: mv.unit, period: mv.period, metric: m.name}) AS metrics " +
        "RETURN properties(e) AS entity, properties(r) AS report, claims, metrics " +
        "ORDER BY r.date",
      { name: entityName },
    );
    const records = (result.data ?? []).map((r) => {
      const obj = r as Record<string, unknown>;
      const filterNulls = (arr: Record<string, unknown>[], key: string) =>
        (arr ?? []).filter((item) => item[key] != null);
      obj.claims = filterNulls(obj.claims as Record<string, unknown>[], "text");
      obj.metrics = filterNulls(
        obj.metrics as Record<string, unknown>[],
        "metric",
      );
      return obj;
    });
    return { entity_name: entityName, reports: records };
  }
}

/**
 * FalkorDB returns internal node/edge ids as integers from `ID()`. The Neo4j
 * reader returns these as opaque strings (via `elementId()`), so we stringify
 * here to keep the cross-backend contract stable.
 */
function stringifyIds(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const out: Record<string, unknown> = { ...obj };
      if (typeof out.id === "number") out.id = String(out.id);
      if (typeof out.startId === "number") out.startId = String(out.startId);
      if (typeof out.endId === "number") out.endId = String(out.endId);
      return out;
    }
    return item;
  });
}
