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
