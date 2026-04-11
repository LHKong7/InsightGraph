import type { Block, ExtractedEntity, DomainConfig } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
import type OpenAI from "openai";
import { formatEntityPrompt, formatEntitySystemPrompt } from "./prompts/entity";

const BATCH_SIZE = 5;
const MAX_CONCURRENCY = 4;

export class EntityExtractor {
  private client: OpenAI;
  private model: string;
  private batchSize: number;

  constructor(
    model: string,
    apiKey: string,
    baseUrl = "",
    batchSize = BATCH_SIZE,
  ) {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
    this.batchSize = batchSize;
  }

  async extract(
    blocks: Block[],
    context?: { title?: string; domain?: DomainConfig },
  ): Promise<ExtractedEntity[]> {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(MAX_CONCURRENCY);
    const docTitle = context?.title ?? "Unknown";
    const domainInstructions = context?.domain?.extractionInstructions ?? "";
    const entityTypes = context?.domain?.entityTypes;

    const batches = makeBatches(blocks, this.batchSize);
    const tasks = batches.map((batch) =>
      limit(() => this.extractBatch(batch, docTitle, domainInstructions, entityTypes)),
    );
    const results = await Promise.allSettled(tasks);

    const all: ExtractedEntity[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    return deduplicate(all);
  }

  private async extractBatch(
    batch: Block[],
    docTitle: string,
    domainInstructions: string,
    entityTypes?: string[],
  ): Promise<ExtractedEntity[]> {
    const combinedText = batch.map((b) => b.content).join("\n\n");
    const blockIds = batch.map((b) => b.id);

    let sectionTitle = "Unknown";
    for (const block of batch) {
      if (block.level != null) { sectionTitle = block.content; break; }
    }

    const systemPrompt = formatEntitySystemPrompt(entityTypes);
    const userPrompt = formatEntityPrompt(combinedText, docTitle, sectionTitle, domainInstructions);

    try {
      const raw = await chatJSON(this.client, this.model, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      return parseEntities(raw, blockIds);
    } catch {
      return [];
    }
  }
}

function parseEntities(rawJson: string, blockIds: string[]): ExtractedEntity[] {
  try {
    const data = JSON.parse(rawJson);
    const entities: ExtractedEntity[] = [];
    for (const e of data.entities ?? []) {
      if (!e.name || !e.type) continue;
      entities.push({
        name: e.name,
        type: e.type,
        description: e.description ?? undefined,
        sourceBlockId: blockIds[0],
        sourceText: e.source_text ?? "",
      });
    }
    return entities;
  } catch {
    return [];
  }
}

function deduplicate(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();
  for (const e of entities) {
    const key = e.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}

function makeBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
