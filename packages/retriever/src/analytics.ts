import { Neo4jConnection } from "@insightgraph/graph";

/**
 * Graph analytics: centrality, co-occurrence, coverage statistics.
 */
export class GraphAnalytics {
  private conn: Neo4jConnection;

  constructor(conn: Neo4jConnection) {
    this.conn = conn;
  }

  /**
   * Rank entities by degree centrality (number of connections).
   */
  async entityImportance(topK = 20): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)-[r]-() " +
      "WITH e, count(r) AS degree " +
      "RETURN e.entity_id AS entity_id, " +
      "       coalesce(e.canonical_name, e.name) AS name, " +
      "       e.entity_type AS entity_type, " +
      "       degree " +
      "ORDER BY degree DESC " +
      "LIMIT $topK";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { topK });
      return result.records.map((r: { toObject(): Record<string, unknown> }) => r.toObject());
    } finally {
      await session.close();
    }
  }

  /**
   * Find entities with the most claims about them.
   */
  async mostClaimedEntities(topK = 20): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)<-[:MENTIONS|ABOUT]-(c:Claim) " +
      "WITH e, count(c) AS claim_count " +
      "RETURN e.entity_id AS entity_id, " +
      "       coalesce(e.canonical_name, e.name) AS name, " +
      "       e.entity_type AS entity_type, " +
      "       claim_count " +
      "ORDER BY claim_count DESC " +
      "LIMIT $topK";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { topK });
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }

  /**
   * Find entities that frequently co-occur with the given entity in claims.
   */
  async entityCoOccurrence(
    entityName: string,
    topK = 10,
  ): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e1:Entity)<-[:MENTIONS|ABOUT]-(c:Claim)-[:MENTIONS|ABOUT]->(e2:Entity) " +
      "WHERE (e1.canonical_name = $name OR e1.name = $name) " +
      "  AND e1 <> e2 " +
      "WITH e2, count(c) AS co_occurrences " +
      "RETURN coalesce(e2.canonical_name, e2.name) AS name, " +
      "       e2.entity_type AS entity_type, " +
      "       co_occurrences " +
      "ORDER BY co_occurrences DESC " +
      "LIMIT $topK";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { name: entityName, topK });
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }

  /**
   * Compute coverage statistics for a report.
   */
  async reportCoverage(reportId: string): Promise<Record<string, unknown>> {
    const query =
      "MATCH (r:Report {report_id: $reportId}) " +
      "OPTIONAL MATCH (r)-[:HAS_SECTION]->(s:Section) " +
      "OPTIONAL MATCH (s)-[:HAS_PARAGRAPH]->(p:Paragraph) " +
      "OPTIONAL MATCH (p)-[:ASSERTS]->(c:Claim) " +
      "OPTIONAL MATCH (p)-[:MENTIONS]->(e:Entity) " +
      "OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue) " +
      "OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(span:SourceSpan) " +
      "RETURN r.title AS title, " +
      "       count(DISTINCT s) AS section_count, " +
      "       count(DISTINCT p) AS paragraph_count, " +
      "       count(DISTINCT c) AS claim_count, " +
      "       count(DISTINCT e) AS entity_count, " +
      "       count(DISTINCT mv) AS metric_value_count, " +
      "       count(DISTINCT span) AS evidence_count, " +
      "       CASE WHEN count(DISTINCT c) > 0 " +
      "            THEN toFloat(count(DISTINCT span)) / count(DISTINCT c) " +
      "            ELSE 0.0 END AS evidence_coverage_ratio";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { reportId });
      const record = result.records[0];
      if (!record) return {};
      return record.toObject();
    } finally {
      await session.close();
    }
  }

  /**
   * Return overall graph statistics.
   */
  async graphSummary(): Promise<Record<string, unknown>> {
    const queries: Record<string, string> = {
      reports: "MATCH (n:Report) RETURN count(n) AS count",
      entities: "MATCH (n:Entity) RETURN count(n) AS count",
      claims: "MATCH (n:Claim) RETURN count(n) AS count",
      metrics: "MATCH (n:Metric) RETURN count(n) AS count",
      metric_values: "MATCH (n:MetricValue) RETURN count(n) AS count",
      paragraphs: "MATCH (n:Paragraph) RETURN count(n) AS count",
      relationships: "MATCH ()-[r]->() RETURN count(r) AS count",
    };

    const stats: Record<string, unknown> = {};
    const session = this.conn.session();
    try {
      for (const [label, query] of Object.entries(queries)) {
        const result = await session.run(query);
        const record = result.records[0];
        stats[label] = record ? record.get("count") : 0;
      }
      return stats;
    } finally {
      await session.close();
    }
  }

  /**
   * Find entities that appear in multiple reports.
   */
  async multiReportEntities(
    minReports = 2,
  ): Promise<Record<string, unknown>[]> {
    const query =
      "MATCH (e:Entity)-[:SOURCED_FROM]->(r:Report) " +
      "WITH e, count(DISTINCT r) AS report_count, " +
      "     collect(r.title) AS report_titles " +
      "WHERE report_count >= $minReports " +
      "RETURN coalesce(e.canonical_name, e.name) AS name, " +
      "       e.entity_type AS entity_type, " +
      "       report_count, " +
      "       report_titles " +
      "ORDER BY report_count DESC";

    const session = this.conn.session();
    try {
      const result = await session.run(query, { minReports });
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }
}
