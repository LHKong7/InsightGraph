import type { LLMClient } from "@insightgraph/core";
import { createLLMClient, chatJSON } from "@insightgraph/core";

export const PLANNER_SYSTEM_PROMPT = `You are a query planner for InsightGraph, a graph-first knowledge system built from reports.

IMPORTANT: Always prefer graph-based tools over generic search. Start with entity lookup, then expand via relationships, claims, and metrics.

Given a user question, determine:
1. question_type: one of "factual", "metric_comparison", "trend_analysis", "risk_identification", "causal_explanation", "evidence_trace", "cross_report", "relationship", "general"
2. tool_plan: an ordered list of tools to call, chosen from:

Graph-first tools (prefer these):
   - find_entities: search for entities by name/type
   - get_entity_profile: get comprehensive entity profile (claims + metrics + relationships + evidence)
   - get_claims_about: get assertions about an entity
   - get_metric_history: get metric values over time for a specific metric
   - find_evidence_for_claim: trace a claim to source text
   - find_related_entities: find entities connected via relationships (args: entity_name, relationship_type, depth)
   - find_path_between_entities: find shortest path between two entities (args: entity_a, entity_b)

Cross-report tools:
   - compare_entity_across_reports: compare entity data across all reports
   - find_metric_trend: detect metric trend for entity (args: entity_name, metric_name)
   - find_contradictions: find contradicting claims about an entity
   - entity_timeline: chronological timeline of claims and metrics

Fallback tools:
   - get_subgraph_for_question: get relevant subgraph for open-ended questions

Strategy guidelines:
- For "who/what is X": use find_entities then get_entity_profile
- For "how does X relate to Y": use find_path_between_entities
- For "what happened to X over time": use entity_timeline or find_metric_trend
- For comparisons: use compare_entity_across_reports
- For contradictions/risks: use find_contradictions
- Always start with find_entities to identify the key entities

Respond in JSON:
{
  "question_type": "trend_analysis",
  "tool_plan": [
    {"tool": "find_entities", "args": {"name": "Company X"}},
    {"tool": "get_entity_profile", "args": {"entity_name": "Company X"}}
  ],
  "reasoning": "brief explanation"
}`;

export interface PlanResult {
  questionType: string;
  toolPlan: Array<{ tool: string; args: Record<string, unknown> }>;
  reasoning: string;
}

/**
 * Decomposes user questions into tool execution plans.
 */
export class Planner {
  private client: LLMClient;
  private model: string;

  constructor(model = "gpt-4o-mini", apiKey = "", baseUrl = "") {
    this.client = createLLMClient(apiKey, baseUrl || undefined);
    this.model = model;
  }

  /**
   * Generate an execution plan for a question.
   *
   * @param question - The user's question.
   * @param context - Optional conversation context from a session.
   * @returns A plan with questionType, toolPlan, and reasoning.
   */
  async plan(question: string, context = ""): Promise<PlanResult> {
    let userContent = question;
    if (context) {
      userContent = `${context}\n\nNew question: ${question}`;
    }

    try {
      const raw = await chatJSON(
        this.client,
        this.model,
        [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        0.0,
      );
      const parsed = JSON.parse(raw);
      return {
        questionType: parsed.question_type ?? "general",
        toolPlan: parsed.tool_plan ?? [],
        reasoning: parsed.reasoning ?? "",
      };
    } catch {
      console.warn("Planner failed, using default plan");
      return {
        questionType: "general",
        toolPlan: [
          {
            tool: "get_subgraph_for_question",
            args: { question },
          },
        ],
        reasoning: "Fallback to subgraph retrieval",
      };
    }
  }
}
