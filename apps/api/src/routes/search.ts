import { Hono } from "hono";
import type { AppState } from "../app";

export const searchRoutes = new Hono<AppState>();

searchRoutes.post("/search", async (c) => {
  const body = await c.req.json<{
    query: string;
    top_k?: number;
    mode?: string;
    report_id?: string;
  }>();

  // Placeholder — requires retriever package to be wired up
  return c.json({
    results: [],
    total: 0,
    message: "Search endpoint ready — connect retriever for full functionality",
  });
});

searchRoutes.post("/retrieve", async (c) => {
  const body = await c.req.json<{
    question: string;
    top_k?: number;
    include_evidence?: boolean;
  }>();

  // Placeholder — requires retriever package
  return c.json({
    paragraphs: [],
    claims: [],
    entities: [],
    metrics: [],
    sources: [],
  });
});

