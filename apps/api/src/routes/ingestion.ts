import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { basename, extname, join } from "path";
import { Hono } from "hono";
import { Queue } from "bullmq";
import type { AppState } from "../app";

export const ingestionRoutes = new Hono<AppState>();

const SUPPORTED_FORMATS = new Set([".pdf", ".csv", ".json"]);

// BullMQ queues (lazy init)
let parseQueue: Queue | null = null;
let buildGraphQueue: Queue | null = null;

function getQueues(redisUrl: string) {
  if (!parseQueue) {
    const url = new URL(redisUrl);
    const connection = { host: url.hostname, port: parseInt(url.port || "6379") };
    parseQueue = new Queue("insightgraph-parse", { connection });
    buildGraphQueue = new Queue("insightgraph-build-graph", { connection });
  }
  return { parseQueue: parseQueue!, buildGraphQueue: buildGraphQueue! };
}

// Task store (in-memory for MVP)
const tasks = new Map<string, {
  taskId: string;
  reportId: string;
  status: string;
  sourceType: string;
  stagedPath?: string;
  error?: string;
}>();

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
    return c.json({ error: `Unsupported format: ${ext}` }, 400);
  }

  // Stage file
  const uploadDir = settings.uploadDir;
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const reportId = randomUUID();
  const taskId = randomUUID();
  const stagedFilename = `${reportId}${ext}`;
  const stagedPath = join(uploadDir, stagedFilename);

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const { writeFileSync } = await import("fs");
  writeFileSync(stagedPath, buffer);

  tasks.set(taskId, {
    taskId,
    reportId,
    status: "pending",
    sourceType: ext.slice(1),
    stagedPath,
  });

  // Dispatch parse job
  const { parseQueue } = getQueues(settings.redisUrl);
  await parseQueue.add("parse", { stagedPath, reportId, taskId });
  tasks.get(taskId)!.status = "parsing";

  return c.json({ task_id: taskId, report_id: reportId, status: "parsing", source_type: ext.slice(1) }, 201);
});

ingestionRoutes.post("/reports/:reportId/parse", async (c) => {
  const reportId = c.req.param("reportId");
  const settings = c.get("settings");
  const taskId = randomUUID();

  // Find staged file
  const uploadDir = settings.uploadDir;
  let stagedPath: string | undefined;
  for (const ext of [".pdf", ".csv", ".json"]) {
    const candidate = join(uploadDir, `${reportId}${ext}`);
    if (existsSync(candidate)) { stagedPath = candidate; break; }
  }

  if (!stagedPath) {
    return c.json({ error: "Report file not found" }, 404);
  }

  tasks.set(taskId, { taskId, reportId, status: "parsing", sourceType: extname(stagedPath).slice(1), stagedPath });

  const { parseQueue } = getQueues(settings.redisUrl);
  await parseQueue.add("parse", { stagedPath, reportId, taskId });

  return c.json({ task_id: taskId, report_id: reportId, status: "parsing" });
});

ingestionRoutes.post("/reports/:reportId/build-graph", async (c) => {
  const reportId = c.req.param("reportId");
  const settings = c.get("settings");
  const taskId = randomUUID();

  tasks.set(taskId, { taskId, reportId, status: "extracting", sourceType: "" });

  const { buildGraphQueue } = getQueues(settings.redisUrl);
  await buildGraphQueue.add("build-graph", { reportId, taskId });

  return c.json({ task_id: taskId, report_id: reportId, status: "extracting" });
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
      });
    }
  }
  return c.json({ error: "Report not found" }, 404);
});
