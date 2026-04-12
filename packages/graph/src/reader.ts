import neo4j from "neo4j-driver";
import { Neo4jConnection, toPlainObject } from "./connection";

export class GraphReader {
  constructor(private conn: Neo4jConnection) {}

  // --- Entity queries ---

  async findEntities(
    name?: string,
    entityType?: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    let query: string;
    const params: Record<string, unknown> = { limit: neo4j.int(Math.trunc(limit)) };

    if (name) {
      query =
        "CALL db.index.fulltext.queryNodes('entity_search', $query) YIELD node, score ";
      if (entityType) query += "WHERE node.entity_type = $entityType ";
      query +=
        "RETURN properties(node) AS entity, score ORDER BY score DESC LIMIT $limit";
      params.query = name;
      if (entityType) params.entityType = entityType;
    } else {
      query = "MATCH (node:Entity) ";
      if (entityType) {
        query += "WHERE node.entity_type = $entityType ";
        params.entityType = entityType;
      }
      query += "RETURN properties(node) AS entity LIMIT $limit";
    }

    const session = this.conn.session();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async getEntity(entityId: string): Promise<Record<string, unknown> | null> {
    const query =
      "MATCH (e:Entity {entity_id: $entityId}) RETURN properties(e) AS entity";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { entityId });
      const record = result.records[0];
      return record ? (toPlainObject(record.get("entity")) as Record<string, unknown>) : null;
    } finally {
      await session.close();
    }
  }

  // --- Claim queries ---

  async getClaimsAbout(entityName: string): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)<-[:MENTIONS|ABOUT]-(c:Claim) " +
      "WHERE e.canonical_name = $entityName OR e.name = $entityName " +
      "RETURN properties(c) AS claim, properties(e) AS entity";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { entityName });
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async findEvidenceForClaim(claimId: string): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (c:Claim {claim_id: $claimId})-[:SUPPORTED_BY]->(s:SourceSpan) " +
      "RETURN properties(s) AS span";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { claimId });
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  // --- Metric queries ---

  async getEntityMetrics(entityName: string): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
      "WHERE e.canonical_name = $entityName OR e.name = $entityName " +
      "RETURN properties(mv) AS metric_value, properties(m) AS metric, " +
      "       properties(e) AS entity ORDER BY m.name, mv.period";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { entityName });
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async getMetricHistory(
    metricName: string,
    entityName?: string,
  ): Promise<Record<string, unknown>[]> {
    let query: string;
    const params: Record<string, unknown> = { metricName };

    if (entityName) {
      query =
        "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "WHERE m.name = $metricName " +
        "  AND (e.canonical_name = $entityName OR e.name = $entityName) " +
        "RETURN properties(mv) AS metric_value, properties(m) AS metric, " +
        "       properties(e) AS entity ORDER BY mv.period";
      params.entityName = entityName;
    } else {
      query =
        "MATCH (mv:MetricValue)-[:MEASURES]->(m:Metric) " +
        "WHERE m.name = $metricName " +
        "RETURN properties(mv) AS metric_value, properties(m) AS metric " +
        "ORDER BY mv.period";
    }

    const session = this.conn.session();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  // --- Subgraph ---

  async getSubgraph(
    nodeId: string,
    depth = 2,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    const d = Math.max(1, Math.min(depth, 5));
    const query =
      "MATCH (start) " +
      "WHERE start.entity_id = $nodeId OR start.report_id = $nodeId " +
      "   OR start.section_id = $nodeId OR start.paragraph_id = $nodeId " +
      "   OR start.claim_id = $nodeId OR start.metric_id = $nodeId " +
      "   OR start.value_id = $nodeId OR start.span_id = $nodeId " +
      "WITH start " +
      `MATCH path = (start)-[*1..${d}]-(neighbour) ` +
      "UNWIND relationships(path) AS rel " +
      "UNWIND nodes(path) AS n " +
      "WITH collect(DISTINCT {id: elementId(n), labels: labels(n), " +
      "             props: properties(n)}) AS nodes, " +
      "     collect(DISTINCT {id: elementId(rel), type: type(rel), " +
      "             startId: elementId(startNode(rel)), " +
      "             endId: elementId(endNode(rel)), " +
      "             props: properties(rel)}) AS edges " +
      "RETURN nodes, edges";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { nodeId });
      const record = result.records[0];
      if (!record) return { nodes: [], edges: [] };
      return {
        nodes: toPlainObject(record.get("nodes")) as unknown[],
        edges: toPlainObject(record.get("edges")) as unknown[],
      };
    } finally {
      await session.close();
    }
  }

  // --- Report queries ---

  async getReport(reportId: string): Promise<Record<string, unknown> | null> {
    const query =
      "MATCH (r:Report {report_id: $reportId}) RETURN properties(r) AS report";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { reportId });
      const record = result.records[0];
      return record ? (toPlainObject(record.get("report")) as Record<string, unknown>) : null;
    } finally {
      await session.close();
    }
  }

  async listReports(): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (r:Report) RETURN properties(r) AS report ORDER BY r.date DESC";
    const session = this.conn.session();
    try {
      const result = await session.run(query);
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  // --- Relationship queries ---

  async getEntityRelationships(entityName: string): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)-[r]-(other:Entity) " +
      "WHERE e.canonical_name = $name OR e.name = $name " +
      "RETURN type(r) AS relationship_type, properties(r) AS relationship_props, " +
      "       properties(other) AS related_entity, " +
      "       CASE WHEN startNode(r) = e THEN 'outgoing' ELSE 'incoming' END AS direction";
    const session = this.conn.session();
    try {
      const result = await session.run(query, { name: entityName });
      return result.records.map((r) => toPlainObject(r.toObject()) as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async findPath(
    entityA: string,
    entityB: string,
    maxDepth = 4,
  ): Promise<{ nodes: unknown[]; edges: unknown[]; found: boolean }> {
    const d = Math.max(1, Math.min(maxDepth, 10));
    const query =
      "MATCH (a:Entity), (b:Entity) " +
      "WHERE (a.canonical_name = $nameA OR a.name = $nameA) " +
      "  AND (b.canonical_name = $nameB OR b.name = $nameB) " +
      `MATCH path = shortestPath((a)-[*1..${d}]-(b)) ` +
      "UNWIND nodes(path) AS n " +
      "UNWIND relationships(path) AS rel " +
      "WITH collect(DISTINCT {labels: labels(n), props: properties(n)}) AS nodes, " +
      "     collect(DISTINCT {type: type(rel), props: properties(rel)}) AS edges " +
      "RETURN nodes, edges";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { nameA: entityA, nameB: entityB });
      const record = result.records[0];
      if (!record) return { nodes: [], edges: [], found: false };
      return {
        nodes: toPlainObject(record.get("nodes")) as unknown[],
        edges: toPlainObject(record.get("edges")) as unknown[],
        found: true,
      };
    } finally {
      await session.close();
    }
  }

  async getEntityFullProfile(entityName: string): Promise<Record<string, unknown>> {
    const query =
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
      "RETURN properties(e) AS entity, claims, evidence, metrics, related_entities, reports";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { name: entityName });
      const record = result.records[0];
      if (!record) return {};
      const data = toPlainObject(record.toObject()) as Record<string, unknown>;
      // Filter null entries from OPTIONAL MATCH
      const filterNulls = (arr: Record<string, unknown>[], key: string) =>
        (arr ?? []).filter((item) => item[key] != null);
      data.claims = filterNulls(data.claims as Record<string, unknown>[], "claim_id");
      data.evidence = filterNulls(data.evidence as Record<string, unknown>[], "text");
      data.metrics = filterNulls(data.metrics as Record<string, unknown>[], "metric_name");
      data.related_entities = filterNulls(data.related_entities as Record<string, unknown>[], "name");
      data.reports = filterNulls(data.reports as Record<string, unknown>[], "report_id");
      return data;
    } finally {
      await session.close();
    }
  }

  async getCrossReportEntity(entityName: string): Promise<Record<string, unknown>> {
    const query =
      "MATCH (e:Entity)-[:SOURCED_FROM]->(r:Report) " +
      "WHERE e.canonical_name = $name OR e.name = $name " +
      "OPTIONAL MATCH (e)<-[:MENTIONS|ABOUT]-(c:Claim)-[:SUPPORTED_BY]->(span:SourceSpan) " +
      "OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) " +
      "WITH r, e, " +
      "  collect(DISTINCT {text: c.text, type: c.claim_type, page: span.page}) AS claims, " +
      "  collect(DISTINCT {value: mv.value, unit: mv.unit, period: mv.period, metric: m.name}) AS metrics " +
      "RETURN properties(e) AS entity, properties(r) AS report, claims, metrics " +
      "ORDER BY r.date";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { name: entityName });
      const records = result.records.map((r) => {
        const obj = toPlainObject(r.toObject()) as Record<string, unknown>;
        const filterNulls = (arr: Record<string, unknown>[], key: string) =>
          (arr ?? []).filter((item) => item[key] != null);
        obj.claims = filterNulls(obj.claims as Record<string, unknown>[], "text");
        obj.metrics = filterNulls(obj.metrics as Record<string, unknown>[], "metric");
        return obj;
      });
      return { entity_name: entityName, reports: records };
    } finally {
      await session.close();
    }
  }
}
