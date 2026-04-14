import type { Job } from "bullmq";
import {
  getSettings,
  loadDomainConfig,
} from "@insightgraph/core";
import type { DocumentIR, ExtractionResult } from "@insightgraph/core";
import { createGraphStore } from "@insightgraph/graph";
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

  console.log(`[build-graph] Starting extraction for report ${reportId}`);
  console.log(`[build-graph] Model: ${settings.llmModel}, Sections: ${doc.sections?.length ?? 0}`);

  // Extract. Extractor concurrency + batch size come from settings so they
  // can be tuned via IG_EXTRACTION_BATCH_SIZE / IG_EXTRACTION_MAX_CONCURRENCY
  // without code changes. See packages/extractor/src/pipeline.ts for the
  // two-phase parallelism model.
  const pipeline = new ExtractionPipeline(
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
    domainConfig,
    {
      batchSize: settings.extractionBatchSize,
      maxConcurrency: settings.extractionMaxConcurrency,
    },
  );
  let extractions: ExtractionResult = await pipeline.extract(doc);
  console.log(`[build-graph] Extraction done: ${extractions.entities.length} entities, ${extractions.metrics.length} metrics, ${extractions.claims.length} claims, ${extractions.relationships.length} relationships`);

  // Resolve entities
  const resolver = new ResolverService(
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
  );
  extractions = await resolver.resolve(extractions);
  console.log(`[build-graph] Resolution done: ${extractions.resolvedEntities.length} resolved entities`);

  // Write to the configured graph backend (Neo4j or SQLite).
  const store = createGraphStore(settings);
  try {
    // Make sure schema is in place — cheap no-op on Neo4j if it already exists,
    // and required for SQLite on the very first run.
    try {
      await store.ensureSchema();
    } catch {
      // non-fatal; legacy deployments may not have constraints privileges
    }
    const writer = store.writer();
    const result = await writer.writeDocument(doc, extractions);
    console.log(
      `[build-graph] Graph written (backend: ${store.kind}):`,
      JSON.stringify(result),
    );
    return result;
  } finally {
    await store.close();
  }
}
