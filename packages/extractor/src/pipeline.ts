import type {
  DocumentIR,
  Block,
  ExtractionResult,
  DomainConfig,
  BlockType,
} from "@insightgraph/core";
import { iterAllBlocks } from "@insightgraph/core";
import { EntityExtractor } from "./entity";
import { MetricExtractor } from "./metric";
import { ClaimExtractor } from "./claim";
import { RelationshipExtractor } from "./relationship";

const DATA_BLOCK_TYPES: Set<BlockType> = new Set(["paragraph", "heading", "data_row"]);

export class ExtractionPipeline {
  private entityExtractor: EntityExtractor;
  private metricExtractor: MetricExtractor;
  private claimExtractor: ClaimExtractor;
  private relationshipExtractor: RelationshipExtractor;
  private domain?: DomainConfig;

  constructor(
    model: string,
    apiKey: string,
    baseUrl = "",
    domainConfig?: DomainConfig,
  ) {
    this.entityExtractor = new EntityExtractor(model, apiKey, baseUrl);
    this.metricExtractor = new MetricExtractor(model, apiKey, baseUrl);
    this.claimExtractor = new ClaimExtractor(model, apiKey, baseUrl);
    this.relationshipExtractor = new RelationshipExtractor(model, apiKey, baseUrl);
    this.domain = domainConfig;
  }

  async extract(doc: DocumentIR): Promise<ExtractionResult> {
    const allBlocks = Array.from(iterAllBlocks(doc));
    const textBlocks: Block[] = allBlocks.filter((b) => DATA_BLOCK_TYPES.has(b.type));

    const context: { title: string; domain?: DomainConfig } = {
      title: doc.title ?? doc.sourceFilename,
      domain: this.domain,
    };

    console.log(`[pipeline] Starting extraction: ${textBlocks.length} blocks`);

    // Extract sequentially to avoid API rate limits with slow reasoning models
    console.log(`[pipeline] Extracting entities...`);
    const entities = await this.entityExtractor.extract(textBlocks, context);
    console.log(`[pipeline] Entities done: ${entities.length}`);

    console.log(`[pipeline] Extracting metrics...`);
    const metrics = await this.metricExtractor.extract(textBlocks, context);
    console.log(`[pipeline] Metrics done: ${metrics.length}`);

    console.log(`[pipeline] Extracting claims...`);
    const claims = await this.claimExtractor.extract(textBlocks, context);
    console.log(`[pipeline] Claims done: ${claims.length}`);

    // Phase 2: Extract relationships (needs entity names from phase 1)
    const entityNames = entities.map((e) => e.name);
    const relationships = await this.relationshipExtractor.extract(textBlocks, {
      title: context.title,
      entityNames,
    });
    console.log(`[pipeline] Relationships done: ${relationships.length}`);

    return {
      documentId: doc.id,
      entities,
      metrics,
      claims,
      relationships,
      resolvedEntities: [],
    };
  }
}
