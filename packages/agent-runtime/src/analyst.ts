import type { LLMClient } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";

export const ANALYST_SYSTEM_PROMPT = `You are an analyst for InsightGraph. Given retrieved data from a knowledge graph, synthesize a clear, evidence-backed answer.

Rules:
1. Only make claims supported by the retrieved data.
2. Cite evidence using page numbers and source spans when available.
3. If the data is insufficient, say so clearly.
4. Structure your response with clear sections if the answer is complex.
5. Include specific numbers, dates, and entity names from the data.

Respond in JSON:
{
  "answer": "The synthesized answer with citations",
  "key_findings": ["finding 1", "finding 2"],
  "evidence_used": [
    {"text": "source quote", "page": 5, "claim_id": "..."}
  ],
  "confidence": 0.85,
  "gaps": ["any information gaps noted"]
}`;

export interface AnalysisResult {
  answer: string;
  keyFindings: string[];
  evidenceUsed: Array<Record<string, unknown>>;
  confidence: number;
  gaps: string[];
}

/**
 * Synthesizes retrieved data into structured analysis with citations.
 */
export class Analyst {
  private client: LLMClient;
  private model: string;

  constructor(model = "gpt-4o-mini", apiKey = "", baseUrl = "") {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
  }

  /**
   * Synthesize retrieval results into an evidence-backed answer.
   */
  async analyze(
    question: string,
    retrievalResults: Array<Record<string, unknown>>,
  ): Promise<AnalysisResult> {
    const context = Analyst.formatContext(retrievalResults);

    try {
      const raw = await chatJSON(
        this.client,
        this.model,
        [
          { role: "system", content: ANALYST_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question: ${question}\n\nRetrieved Data:\n${context}`,
          },
        ],
        0.1,
      );
      const parsed = JSON.parse(raw);
      return {
        answer: parsed.answer ?? "No answer available.",
        keyFindings: parsed.key_findings ?? [],
        evidenceUsed: parsed.evidence_used ?? [],
        confidence: parsed.confidence ?? 0.0,
        gaps: parsed.gaps ?? [],
      };
    } catch {
      console.warn("Analyst failed");
      return {
        answer: "Unable to generate analysis from the available data.",
        keyFindings: [],
        evidenceUsed: [],
        confidence: 0.0,
        gaps: ["Analysis generation failed"],
      };
    }
  }

  /**
   * Format retrieval results into a readable context string.
   */
  static formatContext(results: Array<Record<string, unknown>>): string {
    const parts: string[] = [];
    results.forEach((r, i) => {
      const tool = (r.tool as string) ?? "unknown";
      const result = r.result;
      const error = r.error;
      if (error) {
        parts.push(`[Step ${i + 1}] ${tool}: ERROR - ${error}`);
      } else if (result != null) {
        parts.push(`[Step ${i + 1}] ${tool}:\n${JSON.stringify(result, null, 2)}`);
      } else {
        parts.push(`[Step ${i + 1}] ${tool}: No results`);
      }
    });
    return parts.join("\n\n");
  }
}
