import type { ExtractionResult } from "@insightgraph/core";
import { EntityResolver } from "./entity-resolver";

export class ResolverService {
  private resolver: EntityResolver;

  constructor(model: string, apiKey: string, baseUrl = "") {
    this.resolver = new EntityResolver(model, apiKey, baseUrl);
  }

  async resolve(result: ExtractionResult): Promise<ExtractionResult> {
    const resolved = await this.resolver.resolve(result.entities);

    // Build canonical name map
    const canonicalMap = new Map<string, string>();
    for (const r of resolved) {
      for (const alias of r.aliases) {
        canonicalMap.set(alias.toLowerCase(), r.canonicalName);
      }
    }

    // Update claims with canonical entity names
    const claims = result.claims.map((claim) => ({
      ...claim,
      entitiesMentioned: claim.entitiesMentioned.map(
        (name) => canonicalMap.get(name.toLowerCase()) ?? name,
      ),
    }));

    // Update metrics with canonical entity names
    const metrics = result.metrics.map((metric) => ({
      ...metric,
      entityName: metric.entityName
        ? canonicalMap.get(metric.entityName.toLowerCase()) ?? metric.entityName
        : metric.entityName,
    }));

    return {
      ...result,
      claims,
      metrics,
      resolvedEntities: resolved,
    };
  }
}
