import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { type InsightGraphElectronConfig, type ResolvedConfig, resolveConfig } from "./config";
import { DockerManager } from "./docker-manager";
import { waitForBackend } from "./health-check";
import { checkEnvironment } from "./precheck";

export interface BackendManagerEvents {
  ready: [];
  stopped: [];
  error: [Error];
  stdout: [string];
  stderr: [string];
}

/**
 * Manages the InsightGraph Python backend lifecycle from an Electron main process.
 *
 * Supports two modes:
 * - **source**: spawns `uv run uvicorn ...` (needs Python + uv installed)
 * - **binary**: spawns a pre-packaged executable (no Python needed)
 *
 * @example
 * ```ts
 * const backend = new BackendManager({
 *   mode: "binary",
 *   binaryPath: path.join(process.resourcesPath, "insightgraph-server"),
 *   startDocker: true,
 *   env: { IG_LLM_API_KEY: "sk-xxx" },
 * });
 *
 * await backend.start();
 * // backend.apiUrl === "http://127.0.0.1:8000"
 *
 * app.on("will-quit", () => backend.stop());
 * ```
 */
export class BackendManager extends EventEmitter<BackendManagerEvents> {
  private cfg: ResolvedConfig;
  private docker: DockerManager | null = null;
  private proc: ChildProcess | null = null;
  private _running = false;

  constructor(config: InsightGraphElectronConfig) {
    super();
    this.cfg = resolveConfig(config);
    if (this.cfg.startDocker) {
      this.docker = new DockerManager(
        this.cfg.dockerComposePath,
        this.cfg.neo4jPort,
        this.cfg.redisPort,
      );
    }
  }

  /** Full URL of the running API server. */
  get apiUrl(): string {
    return `http://${this.cfg.apiHost}:${this.cfg.apiPort}`;
  }

  get isRunning(): boolean {
    return this._running;
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /** Start Docker (if configured) and the Python backend. */
  async start(): Promise<void> {
    // 1. Pre-check environment
    const check = await checkEnvironment({
      needPython: this.cfg.mode === "source",
      needDocker: this.cfg.startDocker,
      binaryPath: this.cfg.mode === "binary" ? this.cfg.binaryPath : undefined,
    });

    if (!check.ok) {
      const err = new Error(
        `Missing dependencies:\n${check.missing.map((m) => `  - ${m}`).join("\n")}`,
      );
      this.emit("error", err);
      throw err;
    }

    if (this.cfg.mode === "binary" && !check.binary.available) {
      const err = new Error(`Binary not found at: ${this.cfg.binaryPath}`);
      this.emit("error", err);
      throw err;
    }

    // 2. Start Docker services
    if (this.docker) {
      try {
        await this.docker.start();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.emit("error", err);
        throw err;
      }
    }

    // 3. Spawn backend process
    const env = { ...process.env, ...this.cfg.env };
    const hostArgs = ["--host", this.cfg.apiHost, "--port", String(this.cfg.apiPort)];

    if (this.cfg.mode === "source") {
      this.proc = spawn(
        "uv",
        ["run", "uvicorn", "insightgraph_api.main:app", ...hostArgs],
        { cwd: this.cfg.pythonDir, env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } else {
      this.proc = spawn(this.cfg.binaryPath, hostArgs, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    // Forward stdout/stderr
    this.proc.stdout?.on("data", (chunk: Buffer) =>
      this.emit("stdout", chunk.toString()),
    );
    this.proc.stderr?.on("data", (chunk: Buffer) =>
      this.emit("stderr", chunk.toString()),
    );

    this.proc.on("error", (err) => {
      this._running = false;
      this.emit("error", err);
    });

    this.proc.on("exit", (code) => {
      this._running = false;
      if (code !== 0 && code !== null) {
        this.emit("error", new Error(`Backend exited with code ${code}`));
      }
      this.emit("stopped");
    });

    // 4. Wait for health check
    const healthUrl = `${this.apiUrl}/health`;
    const ready = await waitForBackend(
      healthUrl,
      this.cfg.healthCheckTimeout,
      this.cfg.healthCheckInterval,
    );

    if (!ready) {
      await this.stop();
      const err = new Error(
        `Backend failed to start within ${this.cfg.healthCheckTimeout}ms`,
      );
      this.emit("error", err);
      throw err;
    }

    this._running = true;
    this.emit("ready");
  }

  /** Stop the backend process and Docker services. */
  async stop(): Promise<void> {
    // Kill the backend process
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");

      // Give it 3 seconds, then force kill
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.proc && !this.proc.killed) {
            this.proc.kill("SIGKILL");
          }
          resolve();
        }, 3_000);

        this.proc!.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.proc = null;
    this._running = false;

    // Stop Docker
    if (this.docker) {
      try {
        await this.docker.stop();
      } catch {
        // Best-effort shutdown
      }
    }

    this.emit("stopped");
  }
}
