import type { Block, ExtractedClaim, ClaimType } from "@insightgraph/core";
import { createLLMClient, chatJSON, CLAIM_TYPES } from "@insightgraph/core";
import type { LLMClient } from "@insightgraph/core";
import { CLAIM_SYSTEM_PROMPT, formatClaimPrompt } from "./prompts/claim";
import { createLimiter } from "./concurrency";

const BATCH_SIZE = 5;
const MAX_CONCURRENCY = 4;
const VALID_CLAIM_TYPES = new Set<string>(CLAIM_TYPES);

export class ClaimExtractor {
  private client: LLMClient;
  private model: string;
  private batchSize: number;

  constructor(model: string, apiKey: string, baseUrl = "", batchSize = BATCH_SIZE) {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
    this.batchSize = batchSize;
  }

  async extract(blocks: Block[], context?: { title?: string }): Promise<ExtractedClaim[]> {
    const limit = createLimiter(MAX_CONCURRENCY);
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
    } catch {
      return [];
    }
  }
}

function parseClaimType(raw: string): ClaimType {
  const upper = raw.toUpperCase();
  return VALID_CLAIM_TYPES.has(upper) ? (upper as ClaimType) : "FACTUAL";
}

function parseClaims(rawJson: string, blockIds: string[]): ExtractedClaim[] {
  try {
    const data = JSON.parse(rawJson);
    const claims: ExtractedClaim[] = [];
    for (const c of data.claims ?? []) {
      if (!c.text) continue;
      claims.push({
        text: c.text,
        type: parseClaimType(c.type ?? "FACTUAL"),
        entitiesMentioned: c.entities_mentioned ?? [],
        confidence: typeof c.confidence === "number" ? c.confidence : 1.0,
        sourceBlockId: blockIds[0],
        sourceText: c.source_text ?? "",
      });
    }
    return claims;
  } catch {
    return [];
  }
}

function makeBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
