import { Planner } from "./planner";
import { RetrieverAgent, ToolExecutor, StepResult } from "./retriever-agent";
import { Analyst } from "./analyst";
import { Verifier } from "./verifier";
import { SessionManager } from "./session";

/**
 * The final response from the agent pipeline.
 */
export interface AgentResponse {
  answer: string;
  keyFindings: string[];
  evidence: Array<Record<string, unknown>>;
  confidence: number;
  verified: boolean;
  questionType: string;
  stepsExecuted: number;
}

/**
 * Runs the Planner -> Retriever -> Analyst -> Verifier pipeline.
 * Returns an evidence-backed answer with source citations.
 */
export class Orchestrator {
  private planner: Planner;
  private retriever: RetrieverAgent;
  private analyst: Analyst;
  private verifier: Verifier;
  private _sessionManager: SessionManager;

  constructor(
    tools: ToolExecutor,
    model = "gpt-4o-mini",
    apiKey = "",
    baseUrl = "",
  ) {
    this.planner = new Planner(model, apiKey, baseUrl);
    this.retriever = new RetrieverAgent(tools);
    this.analyst = new Analyst(model, apiKey, baseUrl);
    this.verifier = new Verifier(model, apiKey, baseUrl);
    this._sessionManager = new SessionManager();
  }

  get sessionManager(): SessionManager {
    return this._sessionManager;
  }

  /**
   * Process a question through the full agent pipeline.
   *
   * If sessionId is provided, conversation context is included in planning
   * and the session is updated with findings after the response.
   */
  async query(question: string, sessionId?: string): Promise<AgentResponse> {
    // Get session context if available
    let context = "";
    const session = sessionId
      ? this._sessionManager.getSession(sessionId)
      : undefined;
    if (session) {
      context = session.getContextSummary();
    }

    // Step 1: Plan (with optional session context)
    console.info(`Planning for question: ${question.slice(0, 100)}`);
    const plan = await this.planner.plan(question, context);
    const questionType = plan.questionType;
    const toolPlan = plan.toolPlan;

    // Step 2: Retrieve
    console.info(`Executing ${toolPlan.length} tool steps`);
    const retrievalResults = await this.retriever.executePlan(toolPlan);
    const resultsAsRecords = retrievalResults as unknown as Array<Record<string, unknown>>;

    // Step 3: Analyze
    console.info("Analyzing results");
    const analysis = await this.analyst.analyze(question, resultsAsRecords);

    // Step 4: Verify
    //
    // NOTE: These could *not* safely be parallelized with the Analyst — the
    // Verifier's prompt inspects the Analyst's findings/citations and asserts
    // they're supported by the retrieval. Calling them concurrently with an
    // empty analysis object silently degrades verification quality to "always
    // verified", which is worse than a few hundred ms of latency.
    console.info("Verifying analysis");
    const verification = await this.verifier.verify(
      analysis as unknown as Record<string, unknown>,
      resultsAsRecords,
    );

    // Build response
    const confidence = verification.adjustedConfidence ?? analysis.confidence ?? 0.0;
    const keyFindings = analysis.keyFindings ?? [];

    const response: AgentResponse = {
      answer: analysis.answer ?? "No answer available.",
      keyFindings,
      evidence: analysis.evidenceUsed ?? [],
      confidence,
      verified: verification.verified ?? false,
      questionType,
      stepsExecuted: toolPlan.length,
    };

    // Update session
    if (session) {
      const entitiesFound: string[] = [];
      for (const r of retrievalResults) {
        const result = r.result;
        if (Array.isArray(result)) {
          for (const item of result) {
            if (item && typeof item === "object") {
              const rec = item as Record<string, unknown>;
              if (typeof rec.name === "string") {
                entitiesFound.push(rec.name);
              }
            }
          }
        }
      }
      session.addTurn(question, response.answer, keyFindings, entitiesFound);
    }

    return response;
  }
}
