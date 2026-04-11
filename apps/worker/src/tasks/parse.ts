import type { Job } from "bullmq";
import type { DocumentIR } from "@insightgraph/core";

export interface ParseJobData {
  stagedPath: string;
  reportId: string;
  taskId: string;
}

export async function parseDocument(job: Job<ParseJobData>): Promise<Record<string, unknown>> {
  const { stagedPath, reportId } = job.data;

  const { ParserService } = await import("@insightgraph/parser");
  const service = new ParserService();
  const doc: DocumentIR = await service.parse(stagedPath);

  console.log(`Parsed ${stagedPath} -> ${doc.sections.length} sections`);
  return { reportId, documentIR: doc };
}
