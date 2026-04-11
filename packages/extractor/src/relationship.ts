import type { Block, ExtractedRelationship } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
import type OpenAI from "openai";
import { RELATIONSHIP_SYSTEM_PROMPT, formatRelationshipPrompt } from "./prompts/relationship";

const BATCH_SIZE = 5;
const MAX_CONCURRENCY = 4;
const REL_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class RelationshipExtractor {
  private client: OpenAI;
  private model: string;
  private batchSize: number;

  constructor(model: string, apiKey: string, baseUrl = "", batchSize = BATCH_SIZE) {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
    this.batchSize = batchSize;
  }

  async extract(
    blocks: Block[],
    context?: { title?: string; entityNames?: string[] },
  ): Promise<ExtractedRelationship[]> {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(MAX_CONCURRENCY);
    const docTitle = context?.title ?? "Unknown";
    const entityNames = context?.entityNames ?? [];
    const entityNamesLower = new Set(entityNames.map((n) => n.toLowerCase()));

    const batches = makeBatches(blocks, this.batchSize);
    const tasks = batches.map((batch) =>
      limit(() => this.extractBatch(batch, docTitle, entityNames, entityNamesLower)),
    );
    const results = await Promise.allSettled(tasks);

    const all: ExtractedRelationship[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    return deduplicate(all);
  }

  private async extractBatch(
    batch: Block[],
    docTitle: string,
    entityNames: string[],
    entityNamesLower: Set<string>,
  ): Promise<ExtractedRelationship[]> {
    const combinedText = batch.map((b) => b.content).join("\n\n");
    const blockIds = batch.map((b) => b.id);

    try {
      const raw = await chatJSON(this.client, this.model, [
        { role: "system", content: RELATIONSHIP_SYSTEM_PROMPT },
        { role: "user", content: formatRelationshipPrompt(combinedText, entityNames, docTitle) },
      ]);
      return parseRelationships(raw, blockIds, entityNamesLower);
    } catch {
      return [];
    }
  }
}

function parseRelationships(
  rawJson: string,
  blockIds: string[],
  entityNamesLower: Set<string>,
): ExtractedRelationship[] {
  try {
    const data = JSON.parse(rawJson);
    const rels: ExtractedRelationship[] = [];
    for (const r of data.relationships ?? []) {
      if (!r.source_entity || !r.target_entity || !r.relationship_type) continue;
      const relType = r.relationship_type.toUpperCase().replace(/ /g, "_");
      if (!REL_TYPE_PATTERN.test(relType)) continue;
      if (
        !entityNamesLower.has(r.source_entity.toLowerCase()) ||
        !entityNamesLower.has(r.target_entity.toLowerCase())
      ) continue;

      rels.push({
        sourceEntity: r.source_entity,
        targetEntity: r.target_entity,
        relationshipType: relType,
        description: r.description ?? "",
        confidence: typeof r.confidence === "number" ? r.confidence : 0.8,
        sourceBlockId: blockIds[0],
        sourceText: r.source_text ?? "",
      });
    }
    return rels;
  } catch {
    return [];
  }
}

function deduplicate(rels: ExtractedRelationship[]): ExtractedRelationship[] {
  const seen = new Set<string>();
  return rels.filter((r) => {
    const key = `${r.sourceEntity.toLowerCase()}|${r.targetEntity.toLowerCase()}|${r.relationshipType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
