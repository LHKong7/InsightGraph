import { Worker } from "bullmq";
import { getSettings } from "@insightgraph/core";
import { parseDocument } from "./tasks/parse";
import { buildGraph } from "./tasks/build-graph";

async function main() {
  const settings = getSettings();
  const url = new URL(settings.redisUrl);
  const connection = { host: url.hostname, port: parseInt(url.port || "6379") };

  // Single worker that handles the full pipeline: parse -> extract -> write
  const parseWorker = new Worker("insightgraph-parse", async (job) => {
    // Step 1: Parse
    const parseResult = await parseDocument(job);
    console.log(`Parse complete for report ${job.data.reportId}`);

    // Step 2: Build graph (inline, not via separate queue)
    const { reportId } = parseResult as { reportId: string; documentIR: unknown };
    const documentIR = (parseResult as Record<string, unknown>).documentIR;

    if (documentIR) {
      console.log(`Starting build-graph for report ${reportId}`);
      const fakeJob = { data: { reportId, taskId: job.data.taskId, documentIR } } as any;
      const graphResult = await buildGraph(fakeJob);
      console.log(`Build graph complete:`, JSON.stringify(graphResult));
      return { ...parseResult, graphResult };
    }

    return parseResult;
  }, {
    connection,
    concurrency: 1,
    lockDuration: 600_000, // 10 minutes for the full pipeline
  });

  console.log("InsightGraph worker started (inline pipeline mode)");
  console.log("  Queue: insightgraph-parse");

  parseWorker.on("completed", (job) => {
    console.log(`Pipeline job ${job.id} completed for report ${job.data.reportId}`);
  });

  parseWorker.on("failed", (job, err) => {
    console.error(`Pipeline job ${job?.id} failed:`, err.message);
  });

  process.on("SIGTERM", async () => {
    await parseWorker.close();
    process.exit(0);
  });
}

main().catch(console.error);
