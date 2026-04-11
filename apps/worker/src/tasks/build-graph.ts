import type { Job } from "bullmq";
import {
  getSettings,
  loadDomainConfig,
} from "@insightgraph/core";
import type { DocumentIR, ExtractionResult } from "@insightgraph/core";
import { Neo4jConnection, GraphWriter } from "@insightgraph/graph";
import { ExtractionPipeline } from "@insightgraph/extractor";
import { ResolverService } from "@insightgraph/resolver";

export interface BuildGraphJobData {
  reportId: string;
  taskId: string;
  documentIR?: DocumentIR;
}

export async function buildGraph(job: Job<BuildGraphJobData>): Promise<Record<string, unknown>> {
  const { reportId, documentIR } = job.data;
  if (!documentIR) throw new Error("documentIR required");

  const settings = getSettings();
  const doc = documentIR;
  const domainConfig = loadDomainConfig(settings.domain);

  // Extract
  const pipeline = new ExtractionPipeline(
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
    domainConfig,
  );
  let extractions: ExtractionResult = await pipeline.extract(doc);

  // Resolve entities
  const resolver = new ResolverService(
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
  );
  extractions = await resolver.resolve(extractions);

  // Write to Neo4j
  const conn = new Neo4jConnection(
    settings.neo4jUri,
    settings.neo4jUser,
    settings.neo4jPassword,
  );
  try {
    const writer = new GraphWriter(conn);
    const result = await writer.writeDocument(doc, extractions);
    return result;
  } finally {
    await conn.close();
  }
}
