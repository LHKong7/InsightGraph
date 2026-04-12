import type { Settings, DomainConfig } from "@insightgraph/core";
import { loadDomainConfig } from "@insightgraph/core";
import { ParserService } from "@insightgraph/parser";
import { ExtractionPipeline } from "@insightgraph/extractor";
import { ResolverService } from "@insightgraph/resolver";
import { Neo4jConnection, GraphWriter } from "@insightgraph/graph";
import type { ProgressEvent } from "./types";

/**
 * Run the full ingestion pipeline against a staged file and write the graph to Neo4j.
 *
 * This is a pure library function — no child-process spawn, no HTTP. Callers can
 * consume the returned promise and/or observe stage transitions via `emit`.
 *
 * Accepts an optional `neo4j` connection so long-lived consumers can reuse a single
 * driver across many ingestions (e.g. the {@link InsightGraph} facade). When omitted,
 * a temporary connection is opened and closed for this call.
 */
export async function runPipeline(
  stagedPath: string,
  reportId: string,
  settings: Settings,
  options: {
    emit?: (ev: ProgressEvent) => void;
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

  // 4. Write to Neo4j
  emit({ stage: "writing", reportId });

  const ownConnection = !options.neo4j;
  const conn = options.neo4j ?? new Neo4jConnection(
    settings.neo4jUri,
    settings.neo4jUser,
    settings.neo4jPassword,
  );

  try {
    const writer = new GraphWriter(conn);
    const result = await writer.writeDocument(doc, extractions);
    emit({ stage: "completed", reportId, ...result });
    return result as Awaited<ReturnType<typeof runPipeline>>;
  } finally {
    if (ownConnection) {
      await conn.close();
    }
  }
}
