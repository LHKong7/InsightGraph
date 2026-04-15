import type { Block, ExtractedMetric } from "@insightgraph/core";
import { createLLMClient, chatJSON, safeParseLlmJson, isRecord } from "@insightgraph/core";
import type { LLMClient } from "@insightgraph/core";
import { METRIC_SYSTEM_PROMPT, formatMetricPrompt } from "./prompts/metric";
import { createLimiter } from "./concurrency";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_CONCURRENCY,
  type ExtractorOptions,
} from "./options";

const HAS_DIGIT = /\d/;

export class MetricExtractor {
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

  async extract(blocks: Block[], context?: { title?: string }): Promise<ExtractedMetric[]> {
    const numericBlocks = blocks.filter((b) => HAS_DIGIT.test(b.content));
    if (numericBlocks.length === 0) return [];

    const limit = createLimiter(this.maxConcurrency);
    const docTitle = context?.title ?? "Unknown";

    const batches = makeBatches(numericBlocks, this.batchSize);
    const tasks = batches.map((batch) =>
      limit(() => this.extractBatch(batch, docTitle)),
    );
    const results = await Promise.allSettled(tasks);

    const all: ExtractedMetric[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    return all;
  }

  private async extractBatch(batch: Block[], docTitle: string): Promise<ExtractedMetric[]> {
    const combinedText = batch.map((b) => b.content).join("\n\n");
    const blockIds = batch.map((b) => b.id);

    let sectionTitle = "Unknown";
    for (const block of batch) {
      if (block.level != null) { sectionTitle = block.content; break; }
    }

    try {
      const raw = await chatJSON(this.client, this.model, [
        { role: "system", content: METRIC_SYSTEM_PROMPT },
        { role: "user", content: formatMetricPrompt(combinedText, docTitle, sectionTitle) },
      ]);
      return parseMetrics(raw, blockIds);
    } catch (err) {
      console.warn(`[metric-extractor] LLM call failed: ${(err as Error).message}`);
      return [];
    }
  }
}

function parseMetrics(rawJson: string, blockIds: string[]): ExtractedMetric[] {
  if (blockIds.length === 0) return [];
  const data = safeParseLlmJson<{ metrics?: Array<Record<string, unknown>> }>(
    rawJson,
    { context: "metric-extractor", validate: isRecord },
  );
  if (!data) return [];

  const metrics: ExtractedMetric[] = [];
  for (const m of data.metrics ?? []) {
    // Reject values that aren't coercible to a finite number (e.g. undefined,
    // null, non-numeric strings). parseFloat(undefined) silently yields NaN.
    let value: number;
    if (typeof m.value === "number") {
      value = m.value;
    } else if (typeof m.value === "string" && m.value.trim() !== "") {
      value = parseFloat(m.value);
    } else {
      continue;
    }
    if (!m.name || !Number.isFinite(value)) continue;
    metrics.push({
      name: m.name as string,
      value,
      unit: (m.unit as string | undefined) ?? undefined,
      period: (m.period as string | undefined) ?? undefined,
      entityName: (m.entity_name as string | undefined) ?? undefined,
      sourceBlockId: blockIds[0],
      sourceText: (m.source_text as string | undefined) ?? "",
    });
  }
  return metrics;
}

function makeBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
