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
import type { ExtractorOptions } from "./options";

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
    options: ExtractorOptions = {},
  ) {
    this.entityExtractor = new EntityExtractor(model, apiKey, baseUrl, options);
    this.metricExtractor = new MetricExtractor(model, apiKey, baseUrl, options);
    this.claimExtractor = new ClaimExtractor(model, apiKey, baseUrl, options);
    this.relationshipExtractor = new RelationshipExtractor(model, apiKey, baseUrl, options);
    this.domain = domainConfig;
  }

  /**
   * Run the four extraction stages. Entities, metrics, and claims are all
   * independent — they run *concurrently* via Promise.all. The relationship
   * extractor needs the list of entity names for its prompt and post-filter,
   * so it runs in a second wave.
   *
   * Before parallelization, a large document with ~2000 blocks × 4 categories
   * × concurrency=4 took ~20 minutes (effective concurrency of 4 across the
   * whole pipeline). Running 3 categories in parallel triples the effective
   * concurrency to ~12 during phase 1 and cuts total extraction time roughly
   * in half for typical documents.
   */
  async extract(doc: DocumentIR): Promise<ExtractionResult> {
    const allBlocks = Array.from(iterAllBlocks(doc));
    const textBlocks: Block[] = allBlocks.filter((b) => DATA_BLOCK_TYPES.has(b.type));

    const context: { title: string; domain?: DomainConfig } = {
      title: doc.title ?? doc.sourceFilename,
      domain: this.domain,
    };

    console.log(`[pipeline] Starting extraction: ${textBlocks.length} blocks`);

    // Phase 1: entities + metrics + claims run in parallel. Each extractor
    // manages its own concurrency internally; the outer Promise.allSettled
    // lets their LLM calls interleave so idle RTT on one category is
    // backfilled by work on the others, and — critically — a failure in one
    // category does NOT discard the successful output of the others.
    const phase1Start = Date.now();
    const [entitiesRes, metricsRes, claimsRes] = await Promise.allSettled([
      this.entityExtractor.extract(textBlocks, context),
      this.metricExtractor.extract(textBlocks, context),
      this.claimExtractor.extract(textBlocks, context),
    ]);
    const pickOr = <T>(
      res: PromiseSettledResult<T[]>,
      label: string,
    ): T[] => {
      if (res.status === "fulfilled") return res.value;
      console.warn(
        `[pipeline] ${label} extraction rejected: ${(res.reason as Error)?.message ?? res.reason}`,
      );
      return [];
    };
    const entities = pickOr(entitiesRes, "entity");
    const metrics = pickOr(metricsRes, "metric");
    const claims = pickOr(claimsRes, "claim");
    console.log(
      `[pipeline] Phase 1 done in ${Date.now() - phase1Start}ms: ` +
        `${entities.length} entities, ${metrics.length} metrics, ${claims.length} claims`,
    );

    // Phase 2: relationships depend on phase 1 entity names (used both in
    // the prompt and to post-filter hallucinated endpoints).
    const phase2Start = Date.now();
    const entityNames = entities.map((e) => e.name);
    const relationships = await this.relationshipExtractor.extract(textBlocks, {
      title: context.title,
      entityNames,
    });
    console.log(
      `[pipeline] Phase 2 done in ${Date.now() - phase2Start}ms: ` +
        `${relationships.length} relationships`,
    );

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
