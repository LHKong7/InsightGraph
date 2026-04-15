import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, resolve } from "path";
import { spawn, type ChildProcess } from "child_process";
import { Hono } from "hono";
import type { AppState } from "../app";
import { parseUuidParam } from "../lib/validators";

export const ingestionRoutes = new Hono<AppState>();

/**
 * Registry of pipeline child processes currently running. Used to:
 *   - `unref()` so these children don't keep the Node event loop alive
 *     past normal work (they manage their own lifecycle via the Neo4j driver
 *     / stdout pipes),
 *   - gracefully kill them on SIGTERM so the API can shut down cleanly,
 *   - prevent the task store from evicting a task whose child is still alive.
 */
const liveChildren = new Map<string /* taskId */, ChildProcess>();

function killAllChildren(signal: NodeJS.Signals = "SIGTERM") {
  for (const child of liveChildren.values()) {
    try {
      child.kill(signal);
    } catch {
      // best effort
    }
  }
}

// SIGTERM: give children a grace period, then force-kill. Only install once.
if (!(globalThis as { __igSignalsInstalled?: boolean }).__igSignalsInstalled) {
  (globalThis as { __igSignalsInstalled?: boolean }).__igSignalsInstalled = true;
  const handle = (signal: NodeJS.Signals) => {
    if (liveChildren.size === 0) return;
    console.warn(
      `[ingestion] ${signal} received while ${liveChildren.size} pipeline(s) still running — sending ${signal} to children.`,
    );
    killAllChildren(signal);
    // Escalate if any are still around after the grace period.
    setTimeout(() => {
      if (liveChildren.size > 0) {
        console.warn(
          `[ingestion] ${liveChildren.size} pipeline(s) did not exit — sending SIGKILL.`,
        );
        killAllChildren("SIGKILL");
      }
    }, 5_000).unref?.();
  };
  process.on("SIGTERM", () => handle("SIGTERM"));
  process.on("SIGINT", () => handle("SIGINT"));
}

const SUPPORTED_FORMATS = new Set([".pdf", ".csv", ".json", ".md", ".markdown", ".xlsx", ".xls"]);

interface Task {
  taskId: string;
  reportId: string;
  status: string;
  sourceType: string;
  error?: string;
  result?: Record<string, unknown>;
  /** Epoch ms, set when the task reaches a terminal state. */
  finishedAt?: number;
}

/**
 * Bounded in-memory task store.
 *
 * The original implementation was a plain Map that grew without bound —
 * long-running API processes would slowly leak memory as jobs accumulated,
 * and a flood of uploads could OOM the process. This store:
 *   - caps total entries (LRU-ish: oldest finished tasks evicted first);
 *   - evicts finished tasks that have been done for longer than TASK_TTL_MS.
 *
 * This is still a single-process store — for horizontal scaling we'd move
 * to Redis/BullMQ (there's already a worker service that uses it), but
 * bounding the single-process case keeps the blast radius contained in
 * the meantime.
 */
const TASK_MAX_SIZE = 1000;
const TASK_TTL_MS = 60 * 60 * 1000; // 1h after a task terminates
const TASK_SWEEP_MS = 60 * 1000;

class TaskStore {
  private tasks = new Map<string, Task>();

  set(task: Task) {
    this.tasks.set(task.taskId, task);
    this.enforceCap();
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  values(): IterableIterator<Task> {
    return this.tasks.values();
  }

  markFinished(task: Task) {
    task.finishedAt = Date.now();
  }

  sweep(now: number = Date.now()) {
    for (const [id, t] of this.tasks) {
      if (t.finishedAt !== undefined && now - t.finishedAt > TASK_TTL_MS) {
        this.tasks.delete(id);
      }
    }
  }

  private enforceCap() {
    if (this.tasks.size <= TASK_MAX_SIZE) return;
    // Evict oldest finished tasks first. If we still exceed the cap, we
    // fall back to evicting oldest entries whose child process has already
    // exited — we never drop a task whose pipeline is still running,
    // because its exit-handler would then have nowhere to write the result.
    const ordered = [...this.tasks.entries()];
    ordered.sort(([, a], [, b]) => {
      const af = a.finishedAt ?? Infinity;
      const bf = b.finishedAt ?? Infinity;
      return af - bf;
    });
    while (this.tasks.size > TASK_MAX_SIZE && ordered.length > 0) {
      const [id] = ordered.shift()!;
      if (liveChildren.has(id)) continue; // still running — leave in place
      this.tasks.delete(id);
    }
  }
}

const taskStore = new TaskStore();

// Background sweeper. `unref()` so a pending timer never keeps the process
// alive past normal shutdown.
const _sweeper = setInterval(
  () => taskStore.sweep(),
  TASK_SWEEP_MS,
);
if (typeof _sweeper.unref === "function") _sweeper.unref();

/** Spawn the pipeline as a child process for true background processing. */
function spawnPipeline(stagedPath: string, reportId: string, taskId: string) {
  const runnerPath = resolve(__dirname, "..", "pipeline-runner.js");
  const child = spawn(process.execPath, [runnerPath, stagedPath, reportId], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: false,
  });

  liveChildren.set(taskId, child);
  // Don't let an in-flight pipeline keep the Node event loop alive past a
  // clean API shutdown — the SIGTERM handler above will signal it explicitly.
  if (typeof child.unref === "function") child.unref();

  const stderrBuffer: string[] = [];

  child.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { stage?: string; error?: string; [key: string]: unknown };
        const task = taskStore.get(taskId);
        if (task && msg.stage) {
          task.status = msg.stage;
          if (msg.stage === "completed") {
            const { stage: _s, reportId: _r, ...result } = msg;
            task.result = result as Record<string, unknown>;
            taskStore.markFinished(task);
          }
          if (msg.stage === "failed") {
            task.error = msg.error;
            taskStore.markFinished(task);
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

  child.on("exit", (code, signal) => {
    liveChildren.delete(taskId);
    const task = taskStore.get(taskId);
    if (task && task.status !== "completed" && task.status !== "failed") {
      if (code !== 0) {
        task.status = "failed";
        const stderrOutput = stderrBuffer.join("").trim();
        const causeSuffix = signal ? ` (signal: ${signal})` : "";
        task.error = stderrOutput
          ? `Pipeline exited with code ${code}${causeSuffix}: ${stderrOutput.slice(-600)}`
          : `Pipeline exited with code ${code}${causeSuffix}`;
        taskStore.markFinished(task);
      }
    }
  });

  child.on("error", (err) => {
    liveChildren.delete(taskId);
    const task = taskStore.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = `Failed to spawn pipeline: ${err.message}`;
      taskStore.markFinished(task);
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

  // Enforce size limit BEFORE reading the multipart body into a Buffer — an
  // unchecked arrayBuffer() on a 1 GB upload would OOM the API process.
  const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
  const fileSize = (file as File).size;
  if (typeof fileSize === "number" && fileSize > maxBytes) {
    return c.json(
      {
        error: `File too large: ${Math.round(fileSize / 1024 / 1024)} MB exceeds limit of ${settings.maxFileSizeMb} MB`,
      },
      413,
    );
  }

  const uploadDir = settings.uploadDir;
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const reportId = randomUUID();
  const taskId = randomUUID();
  const stagedFilename = `${reportId}${ext}`;
  const stagedPath = join(uploadDir, stagedFilename);

  const arrayBuf = await (file as File).arrayBuffer();
  // Second guard in case `file.size` wasn't populated by the multipart parser.
  if (arrayBuf.byteLength > maxBytes) {
    return c.json(
      {
        error: `File too large: ${Math.round(arrayBuf.byteLength / 1024 / 1024)} MB exceeds limit of ${settings.maxFileSizeMb} MB`,
      },
      413,
    );
  }
  const buffer = Buffer.from(arrayBuf);
  writeFileSync(stagedPath, buffer);

  taskStore.set({ taskId, reportId, status: "parsing", sourceType: ext.slice(1) });

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
  // Validate reportId is a UUID before letting it flow into path.join() —
  // prevents `../../etc/passwd` style traversal into the upload directory.
  const reportId = parseUuidParam("reportId", c.req.param("reportId"));
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

  taskStore.set({ taskId, reportId, status: "parsing", sourceType: extname(stagedPath).slice(1) });
  spawnPipeline(stagedPath, reportId, taskId);

  return c.json({ task_id: taskId, report_id: reportId, status: "parsing" });
});

ingestionRoutes.post("/reports/:reportId/build-graph", async (c) => {
  return c.json({ error: "Use /reports/upload for the full pipeline" }, 400);
});

ingestionRoutes.get("/reports/:reportId/status", (c) => {
  const reportId = parseUuidParam("reportId", c.req.param("reportId"));
  for (const task of taskStore.values()) {
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
  const list = Array.from(taskStore.values())
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
