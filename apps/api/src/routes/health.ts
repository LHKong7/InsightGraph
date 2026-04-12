import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => c.json({ status: "ok" }));

// Debug: test outgoing fetch from within the API process
healthRoutes.get("/test-fetch", async (c) => {
  const start = Date.now();
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IG_LLM_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: 'Return JSON: {"ok":true}' }],
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    return c.json({
      ok: true,
      elapsed: Date.now() - start,
      response: data,
    });
  } catch (err) {
    return c.json({
      ok: false,
      elapsed: Date.now() - start,
      error: (err as Error).message,
    });
  }
});
