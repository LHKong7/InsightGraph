#!/usr/bin/env node
/**
 * CLI: migrate the full graph between backends.
 *
 * Usage:
 *   tsx packages/graph/src/cli/migrate.ts --from=<neo4j|sqlite> --to=<neo4j|sqlite>
 *     [policy flags — same as merge-sqlite]
 *
 * Connection details come from env vars, same as the running services:
 *   IG_NEO4J_URI / IG_NEO4J_USER / IG_NEO4J_PASSWORD
 *   IG_SQLITE_PATH
 *
 * Example:
 *   IG_SQLITE_PATH=./data/ig.sqlite \
 *     tsx packages/graph/src/cli/migrate.ts --from=neo4j --to=sqlite
 */
import { createSettings, type GraphBackend } from "@insightgraph/core";
import { Neo4jGraphStore } from "../neo4j/store";
import { SqliteGraphStore } from "../sqlite/store";
import { migrateGraph } from "../merge/migrate";
import {
  DEFAULT_MERGE_POLICY,
  type GraphStore,
  type MergePolicy,
} from "../types";

function parseArgs(argv: string[]): { from: GraphBackend; to: GraphBackend; policy: MergePolicy } {
  let from: GraphBackend | null = null;
  let to: GraphBackend | null = null;
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    switch (key) {
      case "from":
        from = value as GraphBackend;
        break;
      case "to":
        to = value as GraphBackend;
        break;
      case "description":
        policy.description = value as MergePolicy["description"];
        break;
      case "aliases":
        policy.aliases = value as MergePolicy["aliases"];
        break;
      case "confidence":
        policy.confidence = value as MergePolicy["confidence"];
        break;
      case "edge-props":
        policy.edgeProps = value as MergePolicy["edgeProps"];
        break;
      case "log-conflicts":
        policy.conflictLog = true;
        break;
      default:
        console.error(`Unknown flag --${key}`);
        process.exit(2);
    }
  }
  if (!from || !to) {
    console.error("Usage: migrate --from=<neo4j|sqlite> --to=<neo4j|sqlite> [flags]");
    process.exit(2);
  }
  if (from === to) {
    console.error("--from and --to must differ");
    process.exit(2);
  }
  return { from, to, policy };
}

function buildStore(kind: GraphBackend): GraphStore {
  const settings = createSettings({ graphBackend: kind });
  if (kind === "sqlite") return new SqliteGraphStore(settings.sqlitePath);
  return new Neo4jGraphStore(
    settings.neo4jUri,
    settings.neo4jUser,
    settings.neo4jPassword,
  );
}

async function main() {
  const { from, to, policy } = parseArgs(process.argv.slice(2));
  const source = buildStore(from);
  const target = buildStore(to);
  try {
    await target.ensureSchema();
    const start = Date.now();
    const stats = await migrateGraph(source, target, policy);
    const duration = Date.now() - start;
    console.log(
      `Migrated ${from} → ${to} in ${duration}ms: ` +
        `nodes=${stats.nodes}, edges=${stats.edges}, conflicts=${stats.conflicts}`,
    );
  } finally {
    await source.close();
    await target.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
