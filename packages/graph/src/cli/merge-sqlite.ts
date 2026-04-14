#!/usr/bin/env node
/**
 * CLI: merge one SQLite graph file into another.
 *
 * Usage:
 *   tsx packages/graph/src/cli/merge-sqlite.ts <target.sqlite> <source.sqlite> \
 *     [--description=preferExisting|overwrite|concat] \
 *     [--aliases=union|preferExisting|overwrite] \
 *     [--confidence=preferHigher|preferExisting|overwrite] \
 *     [--edge-props=preferExisting|overwrite] \
 *     [--log-conflicts]
 *
 * Both files must exist (target will be created with schema if empty). The
 * merge runs inside a single transaction on the target; the source is
 * attached via SQLite ATTACH and then detached on exit.
 */
import { mergeSqliteStore } from "../merge/sqlite-merger";
import { DEFAULT_MERGE_POLICY, type MergePolicy } from "../types";

function parseArgs(argv: string[]): {
  target: string;
  source: string;
  policy: MergePolicy;
} {
  const positional: string[] = [];
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY };
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, value] = arg.slice(2).split("=");
    switch (key) {
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
  if (positional.length !== 2) {
    console.error("Usage: merge-sqlite <target.sqlite> <source.sqlite> [flags]");
    process.exit(2);
  }
  return { target: positional[0], source: positional[1], policy };
}

function main() {
  const { target, source, policy } = parseArgs(process.argv.slice(2));
  const start = Date.now();
  const stats = mergeSqliteStore(target, source, policy);
  const duration = Date.now() - start;
  console.log(
    `Merged ${source} → ${target} in ${duration}ms: ` +
      `nodes=${stats.nodes}, edges=${stats.edges}, conflicts=${stats.conflicts}`,
  );
}

main();
