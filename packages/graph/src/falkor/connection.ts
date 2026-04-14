import { mkdirSync } from "fs";
import { resolve } from "path";
import type { Graph } from "falkordb";
import { FalkorDB, type FalkorDBLiteOptions } from "falkordblite";

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
      opts.path = absolute;
    }
    this.db = await FalkorDB.open(opts);
    this._graph = this.db.selectGraph(this.graphName);
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
  }
}
