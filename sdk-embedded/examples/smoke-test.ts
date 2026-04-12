/**
 * Smoke test for @insightgraph/sdk-embedded.
 *
 *   IG_LLM_API_KEY=... IG_NEO4J_PASSWORD=... node dist/examples/smoke-test.js <path-to-file>
 *
 * Prints progress events as they come in, dumps entity counts, and asks a sample question.
 */
import { InsightGraph } from "../src/index";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node smoke-test.js <path-to-file>");
    process.exit(1);
  }

  const ig = new InsightGraph({
    // All defaults pulled from IG_* env vars — override here as needed.
  });

  ig.on("progress", (ev) => console.log(`  [${ev.stage}] ${ev.reportId}`));
  ig.on("warning", (msg) => console.warn(`  WARN: ${msg}`));

  console.log("→ initialize()");
  await ig.initialize();

  console.log(`→ ingest(${filePath})`);
  const result = await ig.ingest({ filePath });
  console.log(
    `  done: ${result.entities} entities, ${result.metrics} metrics, ` +
      `${result.claims} claims, ${result.relationships} relationships, ${result.edges} edges`,
  );

  console.log("→ listReports()");
  const reports = await ig.listReports();
  console.log(`  ${reports.length} reports in graph`);

  if (result.entities > 0) {
    console.log("→ agentQuery(\"Summarise the main findings.\")");
    const answer = await ig.agentQuery("Summarise the main findings.");
    console.log(`  confidence=${answer.confidence}, verified=${answer.verified}`);
    console.log(`  answer: ${answer.answer.slice(0, 200)}…`);
  }

  console.log("→ close()");
  await ig.close();
  console.log("✓ smoke test complete");
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err);
  process.exit(1);
});
