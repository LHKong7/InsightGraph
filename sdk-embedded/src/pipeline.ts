import type { Settings, DomainConfig } from "@insightgraph/core";
import { loadDomainConfig } from "@insightgraph/core";
import { ParserService } from "@insightgraph/parser";
import { ExtractionPipeline } from "@insightgraph/extractor";
import { ResolverService } from "@insightgraph/resolver";
import {
  createGraphStore,
  Neo4jConnection,
  Neo4jGraphStore,
} from "@insightgraph/graph";
import type { GraphStore } from "@insightgraph/graph";
import type { ProgressEvent } from "./types";

/**
 * Run the full ingestion pipeline against a staged file and write the graph.
 *
 * This is a pure library function — no child-process spawn, no HTTP. Callers can
 * consume the returned promise and/or observe stage transitions via `emit`.
 *
 * Pass an already-opened {@link GraphStore} via `options.store` to reuse one
 * connection across many ingestions (e.g. the {@link InsightGraph} facade).
 * Without it, the pipeline opens a short-lived store derived from `settings.graphBackend`
 * and closes it when the call finishes.
 *
 * The legacy `options.neo4j` parameter is preserved for one release — pass a
 * `Neo4jConnection` to opt into Neo4j specifically.
 */
export async function runPipeline(
  stagedPath: string,
  reportId: string,
  settings: Settings,
  options: {
    emit?: (ev: ProgressEvent) => void;
    /** Re-use an open GraphStore (any backend). */
    store?: GraphStore;
    /** @deprecated use `store` instead. Legacy Neo4j connection override. */
    neo4j?: Neo4jConnection;
    domainConfig?: DomainConfig;
  } = {},
): Promise<{
  reports: number;
  sections: number;
  paragraphs: number;
  source_spans: number;
  entities: number;
  metrics: number;
  metric_values: number;
  claims: number;
  relationships: number;
  edges: number;
}> {
  const emit = options.emit ?? (() => {});

  // 1. Parse
  emit({ stage: "parsing", reportId });
  const parser = new ParserService();
  const doc = await parser.parse(stagedPath);

  // 2. Extract
  emit({ stage: "extracting", reportId, sections: doc.sections.length });
  const domainConfig = options.domainConfig ?? loadDomainConfig(settings.domain);
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
  let extractions = await pipeline.extract(doc);

  // 3. Resolve
  emit({
    stage: "resolving",
    reportId,
    entities: extractions.entities.length,
    metrics: extractions.metrics.length,
    claims: extractions.claims.length,
    relationships: extractions.relationships.length,
  });
  const resolver = new ResolverService(
    settings.llmModel,
    settings.llmApiKey,
    settings.llmBaseUrl,
  );
  extractions = await resolver.resolve(extractions);

  // 4. Write to the graph
  emit({ stage: "writing", reportId });

  // Resolve a GraphStore in priority order:
  //   1. options.store     — user passed an open store (reused across calls)
  //   2. options.neo4j     — legacy Neo4j-only override, wrap in Neo4jGraphStore
  //   3. settings          — create a short-lived store matching graphBackend
  let store: GraphStore;
  let ownsStore = false;
  if (options.store) {
    store = options.store;
  } else if (options.neo4j) {
    // Legacy path: wrap the provided connection in a Neo4jGraphStore so the
    // writer interface is consistent. Caller still owns the raw connection.
    store = new Neo4jGraphStore(
      settings.neo4jUri,
      settings.neo4jUser,
      settings.neo4jPassword,
    );
    ownsStore = true;
  } else {
    store = createGraphStore(settings);
    ownsStore = true;
  }

  try {
    const writer = store.writer();
    const result = await writer.writeDocument(doc, extractions);
    emit({ stage: "completed", reportId, ...result });
    return result as Awaited<ReturnType<typeof runPipeline>>;
  } finally {
    if (ownsStore) {
      await store.close();
    }
  }
}
