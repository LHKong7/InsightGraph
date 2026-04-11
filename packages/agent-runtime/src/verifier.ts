import OpenAI from "openai";
import { createLLMClient, chatJSON } from "@insightgraph/core";

export const VERIFIER_SYSTEM_PROMPT = `You are a verification agent for InsightGraph. Your job is to verify an analysis by checking:

1. Every key finding has supporting evidence from the retrieved data.
2. No contradictions exist between findings.
3. The confidence score is appropriate given the evidence.
4. Citations are accurate.

Respond in JSON:
{
  "verified": true,
  "issues": [],
  "adjusted_confidence": 0.85,
  "evidence_coverage": 0.9,
  "notes": "optional notes"
}

If issues are found:
{
  "verified": false,
  "issues": ["Finding X has no supporting evidence", "Contradiction between..."],
  "adjusted_confidence": 0.4,
  "evidence_coverage": 0.5,
  "notes": "..."
}`;

export interface VerificationResult {
  verified: boolean;
  issues: string[];
  adjustedConfidence: number;
  evidenceCoverage: number;
  notes: string;
}

/**
 * Checks conclusions for evidence support, contradictions, and confidence.
 */
export class Verifier {
  private client: OpenAI;
  private model: string;

  constructor(model = "gpt-4o-mini", apiKey = "", baseUrl = "") {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
  }

  /**
   * Verify an analysis against the retrieved evidence.
   */
  async verify(
    analysis: Record<string, unknown>,
    retrievalResults: Array<Record<string, unknown>>,
  ): Promise<VerificationResult> {
    const context = JSON.stringify(
      { analysis, evidence: retrievalResults },
      null,
      2,
    );

    try {
      const raw = await chatJSON(
        this.client,
        this.model,
        [
          { role: "system", content: VERIFIER_SYSTEM_PROMPT },
          { role: "user", content: `Verify this analysis:\n${context}` },
        ],
        0.0,
      );
      const parsed = JSON.parse(raw);
      return {
        verified: parsed.verified ?? false,
        issues: parsed.issues ?? [],
        adjustedConfidence: parsed.adjusted_confidence ?? 0.0,
        evidenceCoverage: parsed.evidence_coverage ?? 0.0,
        notes: parsed.notes ?? "",
      };
    } catch {
      console.warn("Verifier failed");
      return {
        verified: false,
        issues: ["Verification failed due to an error"],
        adjustedConfidence: 0.0,
        evidenceCoverage: 0.0,
        notes: "Verification unavailable",
      };
    }
  }
}
