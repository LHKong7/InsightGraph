import type { Block, ExtractedClaim, ClaimType } from "@insightgraph/core";
import { createLLMClient, chatJSON, CLAIM_TYPES, safeParseLlmJson, isRecord } from "@insightgraph/core";
import type { LLMClient } from "@insightgraph/core";
import { CLAIM_SYSTEM_PROMPT, formatClaimPrompt } from "./prompts/claim";
import { createLimiter } from "./concurrency";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_CONCURRENCY,
  type ExtractorOptions,
} from "./options";

const VALID_CLAIM_TYPES = new Set<string>(CLAIM_TYPES);

export class ClaimExtractor {
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

  async extract(blocks: Block[], context?: { title?: string }): Promise<ExtractedClaim[]> {
    const limit = createLimiter(this.maxConcurrency);
    const docTitle = context?.title ?? "Unknown";

    const batches = makeBatches(blocks, this.batchSize);
    const tasks = batches.map((batch) =>
      limit(() => this.extractBatch(batch, docTitle)),
    );
    const results = await Promise.allSettled(tasks);

    const all: ExtractedClaim[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    return all;
  }

  private async extractBatch(batch: Block[], docTitle: string): Promise<ExtractedClaim[]> {
    const combinedText = batch.map((b) => b.content).join("\n\n");
    const blockIds = batch.map((b) => b.id);

    let sectionTitle = "Unknown";
    for (const block of batch) {
      if (block.level != null) { sectionTitle = block.content; break; }
    }

    try {
      const raw = await chatJSON(this.client, this.model, [
        { role: "system", content: CLAIM_SYSTEM_PROMPT },
        { role: "user", content: formatClaimPrompt(combinedText, docTitle, sectionTitle) },
      ]);
      return parseClaims(raw, blockIds);
    } catch (err) {
      console.warn(`[claim-extractor] LLM call failed: ${(err as Error).message}`);
      return [];
    }
  }
}

function parseClaimType(raw: string): ClaimType {
  const upper = raw.toUpperCase();
  return VALID_CLAIM_TYPES.has(upper) ? (upper as ClaimType) : "FACTUAL";
}

function parseClaims(rawJson: string, blockIds: string[]): ExtractedClaim[] {
  if (blockIds.length === 0) return [];
  const data = safeParseLlmJson<{ claims?: Array<Record<string, unknown>> }>(
    rawJson,
    { context: "claim-extractor", validate: isRecord },
  );
  if (!data) return [];

  const claims: ExtractedClaim[] = [];
  for (const c of data.claims ?? []) {
    if (!c.text) continue;
    claims.push({
      text: c.text as string,
      type: parseClaimType((c.type as string | undefined) ?? "FACTUAL"),
      entitiesMentioned: (c.entities_mentioned as string[]) ?? [],
      confidence: typeof c.confidence === "number" ? c.confidence : 1.0,
      sourceBlockId: blockIds[0],
      sourceText: (c.source_text as string | undefined) ?? "",
    });
  }
  return claims;
}

function makeBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
