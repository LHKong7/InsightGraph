import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health";
import { ingestionRoutes } from "./routes/ingestion";
import { queryRoutes } from "./routes/query";
import { searchRoutes } from "./routes/search";
import { agentRoutes } from "./routes/agent";

export type AppState = {
  Variables: {
    neo4j: import("@insightgraph/graph").Neo4jConnection;
    settings: import("@insightgraph/core").Settings;
  };
};

export function createApp(
  neo4j: import("@insightgraph/graph").Neo4jConnection,
  settings: import("@insightgraph/core").Settings,
) {
  const app = new Hono<AppState>();

  app.use("*", cors());

  // Global error handler
  app.onError((err, c) => {
    console.error(`[${c.req.method} ${c.req.path}] Error:`, err.message);
    return c.json({ error: err.message }, 500);
  });

  // Inject shared state
  app.use("*", async (c, next) => {
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
