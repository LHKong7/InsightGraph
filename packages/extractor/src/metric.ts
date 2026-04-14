import type { Block, ExtractedMetric } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
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
    } catch {
      return [];
    }
  }
}

function parseMetrics(rawJson: string, blockIds: string[]): ExtractedMetric[] {
  try {
    const data = JSON.parse(rawJson);
    const metrics: ExtractedMetric[] = [];
    for (const m of data.metrics ?? []) {
      const value = typeof m.value === "number" ? m.value : parseFloat(m.value);
      if (!m.name || isNaN(value)) continue;
      metrics.push({
        name: m.name,
        value,
        unit: m.unit ?? undefined,
        period: m.period ?? undefined,
        entityName: m.entity_name ?? undefined,
        sourceBlockId: blockIds[0],
        sourceText: m.source_text ?? "",
      });
    }
    return metrics;
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
