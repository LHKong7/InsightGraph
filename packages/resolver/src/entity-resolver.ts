import type { ExtractedEntity, ResolvedEntity } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
import type { LLMClient } from "@insightgraph/core";

const RESOLUTION_PROMPT = `You are an entity resolution system. Given a list of entity mentions extracted from a document, identify which mentions refer to the same real-world entity.

Group the entities and for each group provide:
- canonical_name: the most complete/formal name
- aliases: all other names that refer to the same entity
- type: the entity type
- description: a brief description if available

Respond in JSON format:
{
  "groups": [
    {
      "canonical_name": "NVIDIA Corporation",
      "aliases": ["NVIDIA", "Nvidia", "NVDA"],
      "type": "ORGANIZATION",
      "description": "Semiconductor company specializing in GPU technology"
    }
  ]
}`;

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[.,]/g, "");
}

function ruleBasedResolve(
  entities: ExtractedEntity[],
): Map<string, ExtractedEntity[]> {
  const groups = new Map<string, ExtractedEntity[]>();
  for (const entity of entities) {
    const key = normalize(entity.name);
    const arr = groups.get(key) ?? [];
    arr.push(entity);
    groups.set(key, arr);
  }
  return groups;
}

function groupsToResolved(
  groups: Map<string, ExtractedEntity[]>,
): ResolvedEntity[] {
  const resolved: ResolvedEntity[] = [];
  for (const entities of groups.values()) {
    // Pick the entity with the longest name as canonical
    const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
    const canonical = sorted[0];
    const aliases = sorted
      .slice(1)
      .map((e) => e.name)
      .filter((n) => n.toLowerCase() !== canonical.name.toLowerCase());

    resolved.push({
      canonicalName: canonical.name,
      type: canonical.type,
      description: canonical.description,
      aliases: [...new Set(aliases)],
      sourceBlockIds: entities.map((e) => e.sourceBlockId),
    });
  }
  return resolved;
}

export class EntityResolver {
  private client: LLMClient;
  private model: string;

  constructor(model: string, apiKey: string, baseUrl = "") {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
  }

  async resolve(entities: ExtractedEntity[]): Promise<ResolvedEntity[]> {
    const groups = ruleBasedResolve(entities);

    // Deduplicate by taking one entity per group
    const unique = Array.from(groups.values()).map((g) => g[0]);
    if (unique.length <= 3) {
      return groupsToResolved(groups);
    }

    try {
      return await this.llmResolve(unique, groups);
    } catch {
      return groupsToResolved(groups);
    }
  }

  private async llmResolve(
    uniqueEntities: ExtractedEntity[],
    originalGroups: Map<string, ExtractedEntity[]>,
  ): Promise<ResolvedEntity[]> {
    const entityList = uniqueEntities
      .map((e) => `- ${e.name} (type: ${e.type}, desc: ${e.description ?? "N/A"})`)
      .join("\n");

    const raw = await chatJSON(this.client, this.model, [
      { role: "system", content: "You are an entity resolution system." },
      { role: "user", content: RESOLUTION_PROMPT + entityList },
    ]);

    const data = JSON.parse(raw);
    const resolved: ResolvedEntity[] = [];

    for (const group of data.groups ?? []) {
      if (!group.canonical_name) continue;
      const allNames = [group.canonical_name, ...(group.aliases ?? [])];
      const sourceBlockIds: string[] = [];
      for (const name of allNames) {
        const key = normalize(name);
        const entities = originalGroups.get(key);
        if (entities) {
          sourceBlockIds.push(...entities.map((e) => e.sourceBlockId));
        }
      }

      resolved.push({
        canonicalName: group.canonical_name,
        type: group.type ?? "OTHER",
        description: group.description ?? undefined,
        aliases: group.aliases ?? [],
        sourceBlockIds: [...new Set(sourceBlockIds)],
      });
    }

    return resolved;
  }
}
