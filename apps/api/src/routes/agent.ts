import { Hono } from "hono";
import type { AppState } from "../app";

export const agentRoutes = new Hono<AppState>();

// Shared session manager (in-memory)
let _sessionManager: import("@insightgraph/agent-runtime").SessionManager | null = null;

async function getSessionManager() {
  if (!_sessionManager) {
    const { SessionManager } = await import("@insightgraph/agent-runtime");
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
}

agentRoutes.post("/agent/query", async (c) => {
  const body = await c.req.json<{
    question: string;
    report_id?: string;
    session_id?: string;
  }>();

  const settings = c.get("settings");
  const neo4j = c.get("neo4j");

  if (!settings.llmApiKey) {
    return c.json({ error: "LLM API key required" }, 400);
  }

  const { Orchestrator } = await import("@insightgraph/agent-runtime");
  const { GraphReader } = await import("@insightgraph/graph");
  const { GraphRetriever, AgentTools } = await import("@insightgraph/retriever");

  const reader = new GraphReader(neo4j);
  const graphRetriever = new GraphRetriever(reader);
  const agentTools = new AgentTools(graphRetriever);

  const orchestrator = new Orchestrator(
    agentTools,
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
  );

  const response = await orchestrator.query(body.question, body.session_id);
  return c.json(response);
});

agentRoutes.post("/sessions", async (c) => {
  const mgr = await getSessionManager();
  const session = mgr.createSession();
  return c.json({
    session_id: session.sessionId,
    created_at: session.createdAt,
    turn_count: 0,
  }, 201);
});

agentRoutes.get("/sessions/:sessionId", async (c) => {
  const mgr = await getSessionManager();
  const session = mgr.getSession(c.req.param("sessionId"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({
    session_id: session.sessionId,
    created_at: session.createdAt,
    turn_count: session.turns.length,
    turns: session.turns,
  });
});

agentRoutes.delete("/sessions/:sessionId", async (c) => {
  const mgr = await getSessionManager();
  mgr.deleteSession(c.req.param("sessionId"));
  return c.json({ deleted: true });
});

agentRoutes.get("/sessions", async (c) => {
  const mgr = await getSessionManager();
  const sessions = mgr.listSessions();
  return c.json(
    sessions.map((s) => ({
      session_id: s.session_id,
      created_at: s.created_at,
      turn_count: (s.turns as unknown[])?.length ?? 0,
    })),
  );
});
