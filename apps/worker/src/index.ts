import { Worker, Queue } from "bullmq";
import { getSettings } from "@insightgraph/core";
import { parseDocument } from "./tasks/parse";
import { buildGraph } from "./tasks/build-graph";

async function main() {
  const settings = getSettings();
  const url = new URL(settings.redisUrl);
  const connection = { host: url.hostname, port: parseInt(url.port || "6379") };

  const buildGraphQueue = new Queue("insightgraph-build-graph", { connection });

  const parseWorker = new Worker("insightgraph-parse", parseDocument, {
    connection,
    concurrency: 2,
  });

  const buildGraphWorker = new Worker("insightgraph-build-graph", buildGraph, {
    connection,
    concurrency: 1,
  });

  console.log("InsightGraph worker started");
  console.log("  Parse queue: insightgraph-parse");
  console.log("  Build graph queue: insightgraph-build-graph");

  // Chain: parse completion -> build-graph job
  parseWorker.on("completed", async (job) => {
    console.log(`Parse job ${job.id} completed`);
    const { reportId, documentIR } = job.returnvalue as {
      reportId: string;
      documentIR: unknown;
    };
    if (documentIR) {
      console.log(`Enqueuing build-graph for report ${reportId}`);
      await buildGraphQueue.add("build-graph", {
        reportId,
        taskId: job.data.taskId,
        documentIR,
      });
    }
  });

  parseWorker.on("failed", (job, err) => {
    console.error(`Parse job ${job?.id} failed:`, err.message);
  });

  buildGraphWorker.on("completed", (job) => {
    console.log(`Build graph job ${job.id} completed`);
    if (job.returnvalue) {
      const counts = job.returnvalue as Record<string, number>;
      console.log(
        `  Result: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      );
    }
  });

  buildGraphWorker.on("failed", (job, err) => {
    console.error(`Build graph job ${job?.id} failed:`, err.message);
  });

  process.on("SIGTERM", async () => {
    await buildGraphQueue.close();
    await parseWorker.close();
    await buildGraphWorker.close();
    process.exit(0);
  });
}

main().catch(console.error);
