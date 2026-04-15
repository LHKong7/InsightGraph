import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { Graph } from "falkordb";
import { FalkorDB, type FalkorDBLiteOptions } from "falkordblite";

/**
 * Return true if a process with the given PID is alive. Uses `process.kill(pid, 0)`
 * which sends no signal but throws ESRCH when the target doesn't exist.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

/**
 * FalkorDB's QueryParam type is a recursive union of primitives + arrays +
 * maps. Our call sites build `{ key: value }` objects where the values are
 * known to be valid at runtime (string/number/boolean/null/array) but
 * TypeScript can't verify that through `Record<string, unknown>`. This alias
 * + the `queryParams()` helper let us pass our params without sprinkling
 * `as never` casts at every call site.
 */
export type QueryParamValue =
  | null
  | string
  | number
  | boolean
  | QueryParamValue[]
  | { [key: string]: QueryParamValue };

export function queryParams(
  params: Record<string, unknown>,
): { params: Record<string, QueryParamValue> } {
  return { params: params as Record<string, QueryParamValue> };
}

/**
 * Wraps `falkordblite` to give us a `FalkorDB` handle + a specific `Graph`.
 *
 * falkordblite automatically downloads a prebuilt `redis-server` + FalkorDB
 * module for the current platform and spawns it as a child process bound to a
 * Unix socket. That process lives for the lifetime of this connection and is
 * cleaned up on `close()`. This is what gives us "zero config" — the only
 * requirement is `npm install`.
 */
export class FalkorConnection {
  readonly graphName: string;
  private db: FalkorDB | null = null;
  private _graph: Graph | null = null;
  private _lockFile: string | null = null;

  constructor(
    private readonly dbPath: string | undefined,
    graphName: string,
    private readonly extra?: Partial<FalkorDBLiteOptions>,
  ) {
    this.graphName = graphName;
  }

  /**
   * Open the embedded server and select the configured graph. Idempotent —
   * repeated calls reuse the existing connection.
   *
   * Acquires a PID-based lock file at `{dbPath}/LOCK` so two processes can't
   * silently collide on the same FalkorDB data directory (which would fight
   * over the embedded redis-server socket and corrupt the RDB/AOF).
   */
  async open(): Promise<void> {
    if (this.db) return;
    const opts: FalkorDBLiteOptions = { ...(this.extra ?? {}) };
    if (this.dbPath && this.dbPath !== ":ephemeral:") {
      const absolute = resolve(this.dbPath);
      try {
        mkdirSync(absolute, { recursive: true });
      } catch {
        // ignore — already exists
      }
      this._acquireLock(absolute);
      opts.path = absolute;
    }
    this.db = await FalkorDB.open(opts);
    this._graph = this.db.selectGraph(this.graphName);
  }

  private _acquireLock(dir: string) {
    const lockPath = join(dir, "LOCK");
    if (existsSync(lockPath)) {
      const raw = readFileSync(lockPath, "utf8").trim();
      const existingPid = Number.parseInt(raw, 10);
      if (Number.isFinite(existingPid) && pidIsAlive(existingPid)) {
        throw new Error(
          `FalkorDB path ${dir} is already in use by PID ${existingPid}. ` +
            `Either close the other process or use a different IG_FALKOR_PATH. ` +
            `If you're certain no other process is running, delete ${lockPath}.`,
        );
      }
      // Stale lock — previous process crashed without cleanup. Claim it.
    }
    writeFileSync(lockPath, String(process.pid));
    this._lockFile = lockPath;
  }

  private _releaseLock() {
    if (!this._lockFile) return;
    try {
      // Only remove if it's still ours — avoid clobbering another process
      // that may have reused the path after our `close()`.
      const raw = readFileSync(this._lockFile, "utf8").trim();
      if (Number.parseInt(raw, 10) === process.pid) {
        unlinkSync(this._lockFile);
      }
    } catch {
      // best effort
    }
    this._lockFile = null;
  }

  /**
   * The typed Graph handle. Callers use `graph.query(cypher, { params })` to
   * run Cypher — the result shape is
   * `{ data: Array<Record<string, unknown>>, metadata: string[] }`.
   */
  graph(): Graph {
    if (!this._graph) {
      throw new Error(
        "FalkorConnection is not open. Call open() before using graph().",
      );
    }
    return this._graph;
  }

  /**
   * Run a Cypher query with plain-JS params. Centralizes the cast from our
   * loose `Record<string, unknown>` to falkordb's strict `QueryParams` type —
   * the runtime values are always compatible, but TS can't verify the
   * recursive union through `unknown`.
   */
  async query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<{ data?: T[]; metadata: string[] }> {
    const g = this.graph();
    const opts = params
      ? ({ params: params as Record<string, QueryParamValue> } as Parameters<
          Graph["query"]
        >[1])
      : undefined;
    const reply = await g.query<T>(cypher, opts);
    return { data: reply.data, metadata: reply.metadata };
  }

  async roQuery<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<{ data?: T[]; metadata: string[] }> {
    const g = this.graph();
    const opts = params
      ? ({ params: params as Record<string, QueryParamValue> } as Parameters<
          Graph["roQuery"]
        >[1])
      : undefined;
    const reply = await g.roQuery<T>(cypher, opts);
    return { data: reply.data, metadata: reply.metadata };
  }

  async verifyConnectivity(): Promise<void> {
    await this.open();
    await this.roQuery("RETURN 1");
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this._graph = null;
    }
    this._releaseLock();
  }
}
