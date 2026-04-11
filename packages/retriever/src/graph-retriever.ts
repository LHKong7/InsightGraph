import { GraphReader } from "@insightgraph/graph";

/**
 * High-level graph retrieval wrapping GraphReader with result formatting.
 */
export class GraphRetriever {
  /** Exposed so other classes (AgentTools, HybridRetriever) can call reader methods directly. */
  readonly _reader: GraphReader;

  constructor(reader: GraphReader) {
    this._reader = reader;
  }

  /**
   * Find entities matching criteria.
   */
  async findEntities(
    name?: string,
    entityType?: string,
    reportId?: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    let results = await this._reader.findEntities(name, entityType, limit);
    if (reportId) {
      results = results.filter((r) => {
        const reportIds = (r as Record<string, unknown>).report_ids as string[] | undefined;
        return reportIds?.includes(reportId);
      });
    }
    return results;
  }

  /**
   * Get all claims that mention an entity.
   */
  async getClaimsAbout(
    entityName: string,
    claimType?: string,
    reportId?: string,
  ): Promise<Record<string, unknown>[]> {
    let claims = await this._reader.getClaimsAbout(entityName);
    if (claimType) {
      claims = claims.filter((c) => {
        const claim = (c.claim ?? c) as Record<string, unknown>;
        return claim.claim_type === claimType;
      });
    }
    if (reportId) {
      claims = claims.filter((c) => {
        const claim = (c.claim ?? c) as Record<string, unknown>;
        return claim.report_id === reportId;
      });
    }
    return claims;
  }

  /**
   * Get historical values for a metric.
   */
  async getMetricHistory(
    metricName: string,
    entityName?: string,
  ): Promise<Record<string, unknown>[]> {
    return this._reader.getMetricHistory(metricName, entityName);
  }

  /**
   * Trace a claim back to its source text and location.
   */
  async findEvidenceForClaim(claimId: string): Promise<Record<string, unknown>[]> {
    return this._reader.findEvidenceForClaim(claimId);
  }

  /**
   * Get a subgraph around a node.
   */
  async getSubgraph(
    nodeId: string,
    depth = 2,
    _maxNodes = 50,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    return this._reader.getSubgraph(nodeId, depth);
  }
}
