import { Hono } from "hono";
import { GraphReader } from "@insightgraph/graph";
import type { AppState } from "../app";

export const queryRoutes = new Hono<AppState>();

queryRoutes.get("/entities/search", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const name = c.req.query("name");
  const entityType = c.req.query("entity_type");
  const limit = parseInt(c.req.query("limit") ?? "50");

  const results = await reader.findEntities(name, entityType, limit);
  return c.json(results);
});

queryRoutes.get("/entities/:entityId", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const entity = await reader.getEntity(c.req.param("entityId"));
  if (!entity) return c.json({ error: "Entity not found" }, 404);
  return c.json(entity);
});

queryRoutes.get("/entities/:entityId/claims", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  // entityId here is actually entity_name in the Python API
  const results = await reader.getClaimsAbout(c.req.param("entityId"));
  return c.json(results);
});

queryRoutes.get("/entities/:entityId/metrics", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const results = await reader.getEntityMetrics(c.req.param("entityId"));
  return c.json(results);
});

queryRoutes.get("/claims/:claimId/evidence", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const results = await reader.findEvidenceForClaim(c.req.param("claimId"));
  return c.json(results);
});

queryRoutes.get("/subgraph/question", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const nodeId = c.req.query("node_id");
  const depth = parseInt(c.req.query("depth") ?? "2");
  if (!nodeId) return c.json({ error: "node_id required" }, 400);
  const result = await reader.getSubgraph(nodeId, depth);
  return c.json(result);
});

queryRoutes.get("/reports", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const reports = await reader.listReports();
  return c.json(reports);
});

queryRoutes.get("/reports/:reportId", async (c) => {
  const neo4j = c.get("neo4j");
  const reader = new GraphReader(neo4j);
  const report = await reader.getReport(c.req.param("reportId"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json(report);
});

/** Get the full subgraph for one report (Report node + all connected entities/claims/metrics). */
queryRoutes.get("/reports/:reportId/graph", async (c) => {
  const neo4j = c.get("neo4j");
  const reportId = c.req.param("reportId");
  const depth = Math.max(1, Math.min(parseInt(c.req.query("depth") ?? "3"), 5));

  // Custom query that walks from the Report node through structure + semantic edges.
  // We intentionally skip the huge SourceSpan/Paragraph fan-out by default so the
  // client gets a readable graph focused on entities, claims, metrics.
  const cypher = `
    MATCH (r:Report {report_id: $reportId})
    OPTIONAL MATCH (r)<-[:SOURCED_FROM]-(e:Entity)
    OPTIONAL MATCH (e)<-[:ABOUT|MENTIONS]-(c:Claim)
    OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric)
    OPTIONAL MATCH (e)-[rel]-(e2:Entity) WHERE e2 <> e AND (e2)-[:SOURCED_FROM]->(r)
    WITH collect(DISTINCT r) + collect(DISTINCT e) + collect(DISTINCT c) + collect(DISTINCT m) + collect(DISTINCT mv) + collect(DISTINCT e2) AS nodeList,
         collect(DISTINCT rel) AS entityRels
    UNWIND nodeList AS node
    WITH collect(DISTINCT {
      id: elementId(node),
      labels: labels(node),
      props: properties(node)
    }) AS nodes, entityRels
    MATCH (r2:Report {report_id: $reportId})
    OPTIONAL MATCH p = (r2)-[*1..${depth}]-(other)
    WHERE any(n IN nodes WHERE n.id = elementId(other))
    UNWIND relationships(p) AS rel
    WITH nodes, entityRels, collect(DISTINCT rel) AS pathRels
    WITH nodes, entityRels + pathRels AS allRels
    UNWIND allRels AS rel
    WITH nodes, collect(DISTINCT {
      id: elementId(rel),
      type: type(rel),
      startId: elementId(startNode(rel)),
      endId: elementId(endNode(rel)),
      props: properties(rel)
    }) AS edges
    RETURN nodes, edges
  `;

  const session = neo4j.session();
  try {
    const result = await session.run(cypher, { reportId });
    const record = result.records[0];
    if (!record) {
      return c.json({ nodes: [], edges: [] });
    }
    const { toPlainObject } = await import("@insightgraph/graph");
    return c.json({
      nodes: toPlainObject(record.get("nodes")),
      edges: toPlainObject(record.get("edges")),
    });
  } finally {
    await session.close();
  }
});
