/**
 * CLI wrapper around `runPipeline()` from @insightgraph/sdk-embedded.
 *
 * The API server spawns this as a child process per ingestion so it can
 * isolate crashes and stream progress via stdout JSON lines.
 *
 * Usage: node pipeline-runner.js <stagedPath> <reportId>
 */
import { getSettings } from "@insightgraph/core";
import { runPipeline } from "@insightgraph/sdk-embedded";

async function main() {
  const [, , stagedPath, reportId] = process.argv;
  if (!stagedPath || !reportId) {
    console.error("Usage: node pipeline-runner.js <stagedPath> <reportId>");
    process.exit(1);
  }

  const settings = getSettings();
  await runPipeline(stagedPath, reportId, settings, {
    emit: (ev) => console.log(JSON.stringify(ev)),
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.log(JSON.stringify({ stage: "failed", error: message }));
  console.error(`Pipeline error: ${message}`);
  if (stack) console.error(stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.log(JSON.stringify({ stage: "failed", error: `Unhandled rejection: ${message}` }));
  console.error(`Unhandled rejection: ${message}`);
  if (reason instanceof Error && reason.stack) console.error(reason.stack);
  process.exit(1);
});
