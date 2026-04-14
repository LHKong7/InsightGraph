import type { Block, ExtractedEntity, DomainConfig } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
import type { LLMClient } from "@insightgraph/core";
import { formatEntityPrompt, formatEntitySystemPrompt } from "./prompts/entity";
import { createLimiter } from "./concurrency";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_CONCURRENCY,
  type ExtractorOptions,
} from "./options";

export class EntityExtractor {
  private client: LLMClient;
  private model: string;
  private batchSize: number;
  private maxConcurrency: number;

  constructor(
    model: string,
    apiKey: string,
    baseUrl = "",
    options: ExtractorOptions = {},
  ) {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  async extract(
    blocks: Block[],
    context?: { title?: string; domain?: DomainConfig },
  ): Promise<ExtractedEntity[]> {
    const limit = createLimiter(this.maxConcurrency);
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
      console.log(`[entity-extractor] Calling LLM (model: ${this.model}, prompt length: ${userPrompt.length})`);
      const raw = await chatJSON(this.client, this.model, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      console.log(`[entity-extractor] LLM response: ${raw.length} chars`);
      return parseEntities(raw, blockIds);
    } catch (err) {
      console.error(`[entity-extractor] LLM call failed:`, (err as Error).message);
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
