import { Hono } from "hono";
import type { AppState } from "../app";
import { parseIntParam } from "../lib/validators";

export const queryRoutes = new Hono<AppState>();

queryRoutes.get("/entities/search", async (c) => {
  const reader = c.get("store").reader();
  const name = c.req.query("name");
  const entityType = c.req.query("entity_type");
  const limit = parseIntParam("limit", c.req.query("limit"), {
    min: 1,
    max: 1000,
    default: 50,
  });

  const results = await reader.findEntities(name, entityType, limit);
  return c.json(results);
});

queryRoutes.get("/entities/:entityId", async (c) => {
  const reader = c.get("store").reader();
  const entity = await reader.getEntity(c.req.param("entityId"));
  if (!entity) return c.json({ error: "Entity not found" }, 404);
  return c.json(entity);
});

queryRoutes.get("/entities/:entityId/claims", async (c) => {
  const reader = c.get("store").reader();
  // entityId here is actually entity_name in the Python API
  const results = await reader.getClaimsAbout(c.req.param("entityId"));
  return c.json(results);
});

queryRoutes.get("/entities/:entityId/metrics", async (c) => {
  const reader = c.get("store").reader();
  const results = await reader.getEntityMetrics(c.req.param("entityId"));
  return c.json(results);
});

queryRoutes.get("/claims/:claimId/evidence", async (c) => {
  const reader = c.get("store").reader();
  const results = await reader.findEvidenceForClaim(c.req.param("claimId"));
  return c.json(results);
});

queryRoutes.get("/subgraph/question", async (c) => {
  const reader = c.get("store").reader();
  const nodeId = c.req.query("node_id");
  const depth = parseIntParam("depth", c.req.query("depth"), {
    min: 1,
    max: 5,
    default: 2,
  });
  if (!nodeId) return c.json({ error: "node_id required" }, 400);
  const result = await reader.getSubgraph(nodeId, depth);
  return c.json(result);
});

queryRoutes.get("/reports", async (c) => {
  const reader = c.get("store").reader();
  const reports = await reader.listReports();
  return c.json(reports);
});

queryRoutes.get("/reports/:reportId", async (c) => {
  const reader = c.get("store").reader();
  const report = await reader.getReport(c.req.param("reportId"));
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json(report);
});

/**
 * Get the full subgraph for one report (Report node + all connected
 * entities/claims/metrics). Implemented with backend-specific code paths:
 *   - Neo4j: runs a tailored Cypher query (original behavior preserved).
 *   - SQLite: uses GraphReader.getSubgraph, which walks via a recursive CTE.
 *
 * On SQLite we still honor the `depth` query parameter.
 */
queryRoutes.get("/reports/:reportId/graph", async (c) => {
  const store = c.get("store");
  const reportId = c.req.param("reportId");
  const depth = parseIntParam("depth", c.req.query("depth"), {
    min: 1,
    max: 5,
    default: 3,
  });

  if (store.kind !== "neo4j") {
    // Non-Neo4j backends (SQLite / FalkorDB) don't run the bespoke Cypher
    // query below — SQLite because it doesn't speak Cypher, FalkorDB because
    // some Neo4j-only functions (`elementId`) aren't available. Both backends
    // provide the same { nodes, edges } shape via the generic getSubgraph
    // reader method, so we use that as a portable fallback.
    const reader = store.reader();
    const result = await reader.getSubgraph(reportId, depth);
    return c.json(result);
  }

  const neo4j = c.get("neo4j");
  if (!neo4j) {
    return c.json(
      { error: `Raw Cypher endpoint not available on backend '${store.kind}'` },
      501,
    );
  }

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
