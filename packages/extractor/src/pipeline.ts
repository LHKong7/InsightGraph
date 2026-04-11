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

    // Phase 1: Extract entities, metrics, claims in parallel
    const [entities, metrics, claims] = await Promise.all([
      this.entityExtractor.extract(textBlocks, context),
      this.metricExtractor.extract(textBlocks, context),
      this.claimExtractor.extract(textBlocks, context),
    ]);

    // Phase 2: Extract relationships (needs entity names from phase 1)
    const entityNames = entities.map((e) => e.name);
    const relationships = await this.relationshipExtractor.extract(textBlocks, {
      title: context.title,
      entityNames,
    });

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
