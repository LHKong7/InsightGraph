import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health";
import { ingestionRoutes } from "./routes/ingestion";
import { queryRoutes } from "./routes/query";
import { searchRoutes } from "./routes/search";
import { agentRoutes } from "./routes/agent";

export type AppState = {
  Variables: {
    store: import("@insightgraph/graph").GraphStore;
    /**
     * Direct Neo4jConnection reference. Only set when the configured backend
     * is Neo4j — the raw Cypher endpoint reads this and returns 501 otherwise.
     */
    neo4j: import("@insightgraph/graph").Neo4jConnection | null;
    settings: import("@insightgraph/core").Settings;
  };
};

export function createApp(
  store: import("@insightgraph/graph").GraphStore,
  settings: import("@insightgraph/core").Settings,
) {
  const app = new Hono<AppState>();

  app.use("*", cors());

  // Global error handler
  app.onError((err, c) => {
    console.error(`[${c.req.method} ${c.req.path}] Error:`, err.message);
    return c.json({ error: err.message }, 500);
  });

  // Resolve a raw Neo4jConnection when available, so the legacy raw-Cypher
  // endpoint can keep working without any behavior change on Neo4j deployments.
  const neo4j =
    store.kind === "neo4j"
      ? (store as import("@insightgraph/graph").Neo4jGraphStore).connection()
      : null;

  // Inject shared state
  app.use("*", async (c, next) => {
    c.set("store", store);
    c.set("neo4j", neo4j);
    c.set("settings", settings);
    await next();
  });

  app.route("/health", healthRoutes);
  app.route("/api/v1", ingestionRoutes);
  app.route("/api/v1", queryRoutes);
  app.route("/api/v1", searchRoutes);
  app.route("/api/v1", agentRoutes);

  return app;
}
