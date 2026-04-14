import type {
  GraphStore,
  ImportStats,
  MergePolicy,
} from "../types";
import { DEFAULT_MERGE_POLICY } from "../types";

/**
 * Cross-backend migration helper. Streams the full graph from `source` into
 * `target`, honoring the merge policy for entity conflicts.
 *
 * Typical usage:
 *   const src = new Neo4jGraphStore(...);
 *   const dst = new SqliteGraphStore("./data/ig.sqlite");
 *   await dst.ensureSchema();
 *   await migrateGraph(src, dst);
 *
 * Works in both directions (Neo4j → SQLite and SQLite → Neo4j) because the
 * GraphStore interface is symmetric.
 */
export async function migrateGraph(
  source: GraphStore,
  target: GraphStore,
  policy: MergePolicy = DEFAULT_MERGE_POLICY,
): Promise<ImportStats> {
  return target.importDump(source.exportDump(), policy);
}
