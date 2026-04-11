import type { Block, ExtractedMetric } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";
import type OpenAI from "openai";
import { METRIC_SYSTEM_PROMPT, formatMetricPrompt } from "./prompts/metric";

const BATCH_SIZE = 5;
const MAX_CONCURRENCY = 4;
const HAS_DIGIT = /\d/;

export class MetricExtractor {
  private client: OpenAI;
  private model: string;
  private batchSize: number;

  constructor(model: string, apiKey: string, baseUrl = "", batchSize = BATCH_SIZE) {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
    this.batchSize = batchSize;
  }

  async extract(blocks: Block[], context?: { title?: string }): Promise<ExtractedMetric[]> {
    const numericBlocks = blocks.filter((b) => HAS_DIGIT.test(b.content));
    if (numericBlocks.length === 0) return [];

    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(MAX_CONCURRENCY);
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
