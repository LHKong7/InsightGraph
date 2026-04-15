import { randomUUID } from "crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
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
    /** Per-request correlation id, echoed back in the X-Request-Id header. */
    requestId: string;
  };
};

export function createApp(
  store: import("@insightgraph/graph").GraphStore,
  settings: import("@insightgraph/core").Settings,
) {
  const app = new Hono<AppState>();

  // CORS allowlist. `settings.corsOrigins` is configured via IG_CORS_ORIGINS
  // (comma-separated). Using ["*"] explicitly allows any origin — intended
  // for local/dev only. `cors()` with an `origin` function returning `""`
  // rejects by returning no Access-Control-Allow-Origin header.
  const allowed = settings.corsOrigins ?? [];
  const allowAny = allowed.length === 1 && allowed[0] === "*";
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (allowAny) return origin ?? "*";
        if (!origin) return ""; // same-origin / non-browser callers get no CORS header
        return allowed.includes(origin) ? origin : "";
      },
      credentials: !allowAny,
    }),
  );

  // Request ID middleware — lets us correlate a client-facing error ID to a
  // detailed server log line without leaking the underlying error message.
  app.use("*", async (c, next) => {
    const requestId =
      c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });

  // Global error handler.
  // In safe mode (production default), we return a generic 500 + requestId
  // and keep the stack trace/message in the server log — otherwise err.message
  // can leak API keys, DB URIs, internal paths, etc.
  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    console.error(
      `[${c.req.method} ${c.req.path}] [${requestId}] Error:`,
      err.stack ?? err.message,
    );

    // Pass through intentional HTTP errors (4xx) raised via HTTPException —
    // their messages are author-controlled and safe to return.
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    if (settings.safeErrorResponses) {
      return c.json(
        { error: "Internal Server Error", request_id: requestId },
        500,
      );
    }
    return c.json({ error: err.message, request_id: requestId }, 500);
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
