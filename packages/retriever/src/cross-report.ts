import { createLLMClient, chatJSON, safeParseLlmJson, isRecord } from "@insightgraph/core";
import type { IGraphReader } from "@insightgraph/graph";
import type { LLMClient } from "@insightgraph/core";

/**
 * Cross-report analysis: compare entities across reports, find trends
 * and contradictions.
 */
export class CrossReportAnalyzer {
  private reader: IGraphReader;
  private client: LLMClient;
  private model: string;

  constructor(
    reader: IGraphReader,
    model = "gpt-4o-mini",
    apiKey = "",
    baseUrl?: string,
  ) {
    this.reader = reader;
    this.model = model;
    this.client = createLLMClient(apiKey, baseUrl);
  }

  /**
   * Compare an entity's claims and metrics across all reports it appears in.
   */
  async compareEntityAcrossReports(
    entityName: string,
  ): Promise<Record<string, unknown>> {
    return this.reader.getCrossReportEntity(entityName);
  }

  /**
   * Find metric values across reports for an entity and detect trend direction.
   */
  async findMetricTrend(
    entityName: string,
    metricName: string,
  ): Promise<Record<string, unknown>> {
    let rows = await this.reader.getMetricHistory(metricName, entityName);

    if (rows.length === 0) {
      // Try without metric_name filter
      const allMetrics = await this.reader.getEntityMetrics(entityName);
      rows = allMetrics.filter((r) => {
        const metric = r.metric as Record<string, unknown> | undefined;
        const name = (metric?.name as string) ?? "";
        return name.toLowerCase().includes(metricName.toLowerCase());
      });
    }

    const values: Record<string, unknown>[] = [];
    for (const row of rows) {
      const mv = (row.metric_value as Record<string, unknown>) ?? {};
      values.push({
        value: mv.value,
        unit: mv.unit,
        period: mv.period,
        metric_name: ((row.metric as Record<string, unknown>) ?? {}).name,
      });
    }

    // Detect trend
    let trend = "unknown";
    if (values.length >= 2) {
      const nums = values
        .map((v) => v.value as number | null)
        .filter((v): v is number => v != null);
      if (nums.length >= 2) {
        if (nums[nums.length - 1] > nums[0]) {
          trend = "increasing";
        } else if (nums[nums.length - 1] < nums[0]) {
          trend = "decreasing";
        } else {
          trend = "stable";
        }
      }
    }

    return {
      entity_name: entityName,
      metric_name: metricName,
      values,
      trend,
      data_points: values.length,
    };
  }

  /**
   * Find claims about an entity that may contradict each other.
   */
  async findContradictions(
    entityName: string,
  ): Promise<Record<string, unknown>[]> {
    const claimsData = await this.reader.getClaimsAbout(entityName);

    if (claimsData.length < 2) return [];

    const claimTexts = claimsData.map((c) => {
      const claim = (c.claim ?? c) as Record<string, unknown>;
      return (claim.text as string) ?? "";
    });

    try {
      return await this.detectContradictionsLLM(entityName, claimTexts, claimsData);
    } catch (err) {
      console.warn("Contradiction detection failed", err);
      return [];
    }
  }

  private async detectContradictionsLLM(
    entityName: string,
    claimTexts: string[],
    _claimsData: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const numbered = claimTexts
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");

    const prompt =
      `Given these claims about '${entityName}', identify any contradictions.\n\n` +
      `${numbered}\n\n` +
      `Respond in JSON: {"contradictions": [{"claim_a": 1, "claim_b": 3, ` +
      `"explanation": "why they contradict"}]}`;

    const raw = await chatJSON(
      this.client,
      this.model,
      [
        { role: "system", content: "You detect contradictions between claims." },
        { role: "user", content: prompt },
      ],
      0,
    );
    const data = safeParseLlmJson<{
      contradictions?: Array<{
        claim_a?: number;
        claim_b?: number;
        explanation?: string;
      }>;
    }>(raw, { context: "cross-report.contradictions", validate: isRecord });
    if (!data) return [];

    const results: Record<string, unknown>[] = [];
    for (const c of data.contradictions ?? []) {
      // Require both claim indices to be present & valid — don't silently
      // fall back to 0/1, which would fabricate a contradiction.
      if (typeof c.claim_a !== "number" || typeof c.claim_b !== "number") {
        continue;
      }
      const idxA = c.claim_a - 1;
      const idxB = c.claim_b - 1;
      if (idxA >= 0 && idxA < claimTexts.length && idxB >= 0 && idxB < claimTexts.length && idxA !== idxB) {
        results.push({
          claim_a: claimTexts[idxA],
          claim_b: claimTexts[idxB],
          explanation: c.explanation ?? "",
        });
      }
    }
    return results;
  }

  /**
   * Build a chronological timeline of claims and metrics for an entity.
   */
  async entityTimeline(entityName: string): Promise<Record<string, unknown>[]> {
    const profile = await this.reader.getEntityFullProfile(entityName);
    if (!profile || Object.keys(profile).length === 0) return [];

    const timeline: Record<string, unknown>[] = [];

    const claims = (profile.claims as Record<string, unknown>[]) ?? [];
    for (const claim of claims) {
      timeline.push({
        type: "claim",
        text: claim.text,
        claim_type: claim.type,
        period: null,
      });
    }

    const metrics = (profile.metrics as Record<string, unknown>[]) ?? [];
    for (const metric of metrics) {
      timeline.push({
        type: "metric",
        text: `${metric.metric_name}: ${metric.value} ${(metric.unit as string) ?? ""}`,
        period: metric.period,
        value: metric.value,
        metric_name: metric.metric_name,
      });
    }

    // Sort by period (metrics with periods first, then claims)
    timeline.sort((a, b) => {
      const pa = (a.period as string) ?? "zzz";
      const pb = (b.period as string) ?? "zzz";
      if (pa !== pb) return pa.localeCompare(pb);
      return ((a.type as string) ?? "").localeCompare((b.type as string) ?? "");
    });

    return timeline;
  }
}
