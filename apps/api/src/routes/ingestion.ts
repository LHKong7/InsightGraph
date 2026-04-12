import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, resolve } from "path";
import { spawn } from "child_process";
import { Hono } from "hono";
import type { AppState } from "../app";

export const ingestionRoutes = new Hono<AppState>();

const SUPPORTED_FORMATS = new Set([".pdf", ".csv", ".json", ".md", ".markdown", ".xlsx", ".xls"]);

// In-memory task store
const tasks = new Map<string, {
  taskId: string;
  reportId: string;
  status: string;
  sourceType: string;
  error?: string;
  result?: Record<string, unknown>;
}>();

/** Spawn the pipeline as a child process for true background processing. */
function spawnPipeline(stagedPath: string, reportId: string, taskId: string) {
  const runnerPath = resolve(__dirname, "..", "pipeline-runner.js");
  const child = spawn(process.execPath, [runnerPath, stagedPath, reportId], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: false,
  });

  const stderrBuffer: string[] = [];

  child.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { stage?: string; error?: string; [key: string]: unknown };
        const task = tasks.get(taskId);
        if (task && msg.stage) {
          task.status = msg.stage;
          if (msg.stage === "completed") {
            const { stage: _s, reportId: _r, ...result } = msg;
            task.result = result as Record<string, unknown>;
          }
          if (msg.stage === "failed") {
            task.error = msg.error;
          }
        }
        console.log(`[pipeline:${reportId.slice(0, 8)}] ${line}`);
      } catch {
        console.log(`[pipeline:${reportId.slice(0, 8)}] ${line}`);
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuffer.push(text);
    // Keep only the last ~4KB of stderr
    const combined = stderrBuffer.join("");
    if (combined.length > 4096) {
      stderrBuffer.splice(0, stderrBuffer.length);
      stderrBuffer.push(combined.slice(-4096));
    }
    console.error(`[pipeline:${reportId.slice(0, 8)}:err] ${text.trim()}`);
  });

  child.on("exit", (code) => {
    const task = tasks.get(taskId);
    if (task && task.status !== "completed" && task.status !== "failed") {
      if (code !== 0) {
        task.status = "failed";
        const stderrOutput = stderrBuffer.join("").trim();
        task.error = stderrOutput
          ? `Pipeline exited with code ${code}: ${stderrOutput.slice(-600)}`
          : `Pipeline exited with code ${code}`;
      }
    }
  });

  child.on("error", (err) => {
    const task = tasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = `Failed to spawn pipeline: ${err.message}`;
    }
  });
}

ingestionRoutes.post("/reports/upload", async (c) => {
  const settings = c.get("settings");
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || typeof file === "string") {
    return c.json({ error: "No file provided" }, 400);
  }

  const filename = (file as File).name;
  const ext = extname(filename).toLowerCase();
  if (!SUPPORTED_FORMATS.has(ext)) {
    return c.json({ error: `Unsupported format: ${ext}. Supported: ${[...SUPPORTED_FORMATS].join(", ")}` }, 400);
  }

  const uploadDir = settings.uploadDir;
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const reportId = randomUUID();
  const taskId = randomUUID();
  const stagedFilename = `${reportId}${ext}`;
  const stagedPath = join(uploadDir, stagedFilename);

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  writeFileSync(stagedPath, buffer);

  tasks.set(taskId, { taskId, reportId, status: "parsing", sourceType: ext.slice(1) });

  // Spawn pipeline as child process — runs in background
  spawnPipeline(stagedPath, reportId, taskId);

  return c.json({
    task_id: taskId,
    report_id: reportId,
    status: "parsing",
    source_type: ext.slice(1),
  }, 201);
});

ingestionRoutes.post("/reports/:reportId/parse", async (c) => {
  const reportId = c.req.param("reportId");
  const settings = c.get("settings");
  const taskId = randomUUID();

  const uploadDir = settings.uploadDir;
  let stagedPath: string | undefined;
  for (const ext of [".pdf", ".csv", ".json", ".md", ".markdown", ".xlsx", ".xls"]) {
    const candidate = join(uploadDir, `${reportId}${ext}`);
    if (existsSync(candidate)) { stagedPath = candidate; break; }
  }

  if (!stagedPath) {
    return c.json({ error: "Report file not found" }, 404);
  }

  tasks.set(taskId, { taskId, reportId, status: "parsing", sourceType: extname(stagedPath).slice(1) });
  spawnPipeline(stagedPath, reportId, taskId);

  return c.json({ task_id: taskId, report_id: reportId, status: "parsing" });
});

ingestionRoutes.post("/reports/:reportId/build-graph", async (c) => {
  return c.json({ error: "Use /reports/upload for the full pipeline" }, 400);
});

ingestionRoutes.get("/reports/:reportId/status", (c) => {
  const reportId = c.req.param("reportId");
  for (const task of tasks.values()) {
    if (task.reportId === reportId) {
      return c.json({
        report_id: task.reportId,
        task_id: task.taskId,
        status: task.status,
        error: task.error,
        result: task.result,
      });
    }
  }
  return c.json({ error: "Report not found" }, 404);
});

/** List all known tasks — active and completed. Optional `status` filter. */
ingestionRoutes.get("/jobs", (c) => {
  const filter = c.req.query("status");
  const list = Array.from(tasks.values())
    .filter((t) => !filter || t.status === filter)
    .map((t) => ({
      task_id: t.taskId,
      report_id: t.reportId,
      status: t.status,
      source_type: t.sourceType,
      error: t.error,
      result: t.result,
    }));

  const summary = {
    total: list.length,
    active: list.filter((t) => !["completed", "failed"].includes(t.status)).length,
    completed: list.filter((t) => t.status === "completed").length,
    failed: list.filter((t) => t.status === "failed").length,
  };

  return c.json({ summary, jobs: list });
});
