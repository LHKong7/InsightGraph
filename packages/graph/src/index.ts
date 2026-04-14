import type { Settings } from "@insightgraph/core";
import { Neo4jGraphStore } from "./neo4j/store";
import { SqliteGraphStore } from "./sqlite/store";
import { FalkorGraphStore } from "./falkor/store";
import type { GraphStore } from "./types";

// -- Public type re-exports ---------------------------------------------------
// NOTE: the `GraphReader` / `GraphWriter` *interfaces* in ./types intentionally
// share names with the concrete classes exported below. To avoid a duplicate
// export collision at the barrel, we only re-export the *interfaces* under
// alternate names. Most callers only need GraphStore (and the reader/writer
// objects it returns), which transitively carry the interface types.
export type {
  GraphStore,
  GraphReader as IGraphReader,
  GraphWriter as IGraphWriter,
  GraphDumpChunk,
  ImportStats,
  MergePolicy,
  GraphBackend,
} from "./types";
export { DEFAULT_MERGE_POLICY, UnsupportedBackendError } from "./types";

// -- Neo4j backend (legacy direct exports) ------------------------------------
export { Neo4jConnection, toPlainObject } from "./neo4j/connection";
export { ensureSchema } from "./neo4j/schema";
export { GraphReader as Neo4jGraphReader } from "./neo4j/reader";
export { GraphWriter as Neo4jGraphWriter } from "./neo4j/writer";
export { Neo4jGraphStore } from "./neo4j/store";

// Retain the historical `GraphReader` / `GraphWriter` names so existing
// imports (apps/api/src/routes/query.ts, apps/worker/src/tasks/build-graph.ts)
// continue to work unchanged. These aliases resolve to the Neo4j
// implementations — identical to pre-refactor behavior.
export { GraphReader } from "./neo4j/reader";
export { GraphWriter } from "./neo4j/writer";

// -- SQLite backend -----------------------------------------------------------
export { SqliteConnection } from "./sqlite/connection";
export { SqliteGraphReader } from "./sqlite/reader";
export { SqliteGraphWriter } from "./sqlite/writer";
export { SqliteGraphStore } from "./sqlite/store";

// -- FalkorDB backend ---------------------------------------------------------
export { FalkorConnection } from "./falkor/connection";
export { FalkorGraphReader } from "./falkor/reader";
export { FalkorGraphWriter } from "./falkor/writer";
export { FalkorGraphStore } from "./falkor/store";

// -- Merge utilities ----------------------------------------------------------
export { mergeSqliteStore } from "./merge/sqlite-merger";
export { migrateGraph } from "./merge/migrate";

/**
 * Create a GraphStore backed by the configured backend. Selection is driven
 * by `settings.graphBackend` (env: `IG_GRAPH_BACKEND=neo4j|sqlite`, default
 * `neo4j`). SQLite uses `settings.sqlitePath` (env: `IG_SQLITE_PATH`).
 *
 * The returned store exposes reader()/writer()/ensureSchema()/export/import
 * methods — see ./types.ts for the contract.
 */
export function createGraphStore(settings: Settings): GraphStore {
  if (settings.graphBackend === "sqlite") {
    return new SqliteGraphStore(settings.sqlitePath);
  }
  if (settings.graphBackend === "falkor") {
    return new FalkorGraphStore(settings.falkorPath, settings.falkorGraphName);
  }
  return new Neo4jGraphStore(
    settings.neo4jUri,
    settings.neo4jUser,
    settings.neo4jPassword,
  );
}
