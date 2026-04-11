import { GraphRetriever } from "./graph-retriever";

// ------------------------------------------------------------------
// Structured result model
// ------------------------------------------------------------------

export interface RetrievalResult {
  paragraphs: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  metrics: Record<string, unknown>[];
  sources: Record<string, unknown>[];
}

// ------------------------------------------------------------------
// HybridRetriever -- GRAPH-FIRST architecture
// ------------------------------------------------------------------

/**
 * Graph-first retriever.
 *
 * Leads with graph queries: fulltext entity search, then expands
 * neighborhoods (claims, metrics, relationships, evidence).
 */
export class HybridRetriever {
  private graph: GraphRetriever;

  constructor(graphRetriever: GraphRetriever) {
    this.graph = graphRetriever;
  }

  /**
   * Graph-first search.
   *
   * 1. Entity fulltext search
   * 2. Expand to claims about found entities
   */
  async search(
    query: string,
    topK = 10,
    reportId?: string,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    const entityNames = new Set<string>();

    // Find entities matching the query via fulltext
    const foundEntities = await this.graph.findEntities(
      query,
      undefined,
      reportId,
      topK,
    );
    for (const entityRec of foundEntities) {
      const entityData = (entityRec.entity ?? entityRec) as Record<string, unknown>;
      entityData.result_type = "entity";
      entityData.source = "graph";
      results.push(entityData);
      const ename =
        (entityData.canonical_name as string) || (entityData.name as string);
      if (ename) entityNames.add(ename);
    }

    // Expand entity neighborhoods: claims about each entity
    for (const ename of entityNames) {
      const claims = await this.graph.getClaimsAbout(ename, undefined, reportId);
      for (const claimRec of claims) {
        const claimData = (claimRec.claim ?? claimRec) as Record<string, unknown>;
        claimData.result_type = "claim";
        claimData.source = "graph";
        if (!claimData.mentioned_entity) claimData.mentioned_entity = ename;
        results.push(claimData);
      }
    }

    return results.slice(0, topK);
  }

  /**
   * High-level retrieval returning structured RetrievalResult.
   *
   * Uses graph-first search, then enriches with entity metrics.
   */
  async retrieveForQuestion(
    question: string,
    topK = 10,
  ): Promise<RetrievalResult> {
    const results = await this.search(question, topK);

    const paragraphs: Record<string, unknown>[] = [];
    const claims: Record<string, unknown>[] = [];
    const entities: Record<string, unknown>[] = [];
    const sources: Record<string, unknown>[] = [];
    const seenEntityNames = new Set<string>();

    for (const item of results) {
      const resultType = item.result_type as string;
      sources.push({
        key: resultType,
        source: item.source ?? "graph",
        result_type: resultType,
      });

      if (resultType === "claim") {
        claims.push(item);
        const me = item.mentioned_entity as string;
        if (me) seenEntityNames.add(me);
      } else if (resultType === "entity") {
        entities.push(item);
        const name =
          (item.canonical_name as string) || (item.name as string);
        if (name) seenEntityNames.add(name);
      }
    }

    // Fetch metrics for discovered entities
    const metrics: Record<string, unknown>[] = [];
    const entityNameList = [...seenEntityNames].slice(0, 5);
    for (const ename of entityNameList) {
      try {
        const metricRows = await this.graph._reader.getEntityMetrics(ename);
        metrics.push(...metricRows);
      } catch {
        // Metric lookup failed — skip silently
      }
    }

    return { paragraphs, claims, entities, metrics, sources };
  }
}
