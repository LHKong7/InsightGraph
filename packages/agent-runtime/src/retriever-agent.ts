/**
 * Tool executor interface. The consumer must provide an object with an
 * `execute(toolName, args)` method that resolves to a result value.
 */
export interface ToolExecutor {
  execute(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface StepResult {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  error: string | null;
}

/**
 * Iterative retriever that follows graph connections across rounds.
 *
 * Unlike a simple for-loop executor, this agent:
 * 1. Executes the initial plan
 * 2. Extracts entities from results
 * 3. Generates follow-up queries to explore entity neighborhoods
 * 4. Stops when no new information is found or max_iterations reached
 */
export class RetrieverAgent {
  private tools: ToolExecutor;
  private maxIterations: number;

  constructor(tools: ToolExecutor, maxIterations = 3) {
    this.tools = tools;
    this.maxIterations = maxIterations;
  }

  /**
   * Execute a tool plan with iterative graph exploration.
   * Returns a list of step result dicts.
   */
  async executePlan(
    toolPlan: Array<{ tool: string; args: Record<string, unknown> }>,
  ): Promise<StepResult[]> {
    const allResults: StepResult[] = [];
    const discoveredEntities = new Set<string>();

    // Round 1: Execute the original plan
    let roundResults = await this.executeSteps(toolPlan);
    allResults.push(...roundResults);

    // Extract entities from results
    const newEntities = RetrieverAgent.extractEntities(roundResults);
    for (const e of newEntities) discoveredEntities.add(e);

    // Round 2+: Follow graph connections
    for (let iteration = 0; iteration < this.maxIterations - 1; iteration++) {
      const followUps = RetrieverAgent.generateFollowUps(roundResults, discoveredEntities);
      if (followUps.length === 0) break;

      roundResults = await this.executeSteps(followUps);
      allResults.push(...roundResults);

      const freshEntities = RetrieverAgent.extractEntities(roundResults);
      let hasNew = false;
      for (const e of freshEntities) {
        if (!discoveredEntities.has(e)) {
          discoveredEntities.add(e);
          hasNew = true;
        }
      }
      if (!hasNew) break;
    }

    return allResults;
  }

  private async executeSteps(
    steps: Array<{ tool: string; args: Record<string, unknown> }>,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of steps) {
      const toolName = step.tool ?? "";
      const args = step.args ?? {};
      try {
        const result = await this.tools.execute(toolName, args);
        results.push({ tool: toolName, args, result, error: null });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`Tool ${toolName} failed: ${message}`);
        results.push({ tool: toolName, args, result: null, error: message });
      }
    }
    return results;
  }

  /**
   * Extract entity names from tool execution results.
   */
  static extractEntities(results: StepResult[]): Set<string> {
    const entities = new Set<string>();

    for (const r of results) {
      const result = r.result;
      if (result == null) continue;

      if (Array.isArray(result)) {
        for (const item of result) {
          if (item && typeof item === "object") {
            const rec = item as Record<string, unknown>;
            for (const key of ["name", "canonical_name", "entity_name", "mentioned_entity"]) {
              const val = rec[key];
              if (typeof val === "string" && val) entities.add(val);
            }
            // Also check nested entity dicts
            const entity = rec.entity;
            if (entity && typeof entity === "object") {
              const entityRec = entity as Record<string, unknown>;
              for (const key of ["name", "canonical_name"]) {
                const val = entityRec[key];
                if (typeof val === "string" && val) entities.add(val);
              }
            }
          }
        }
      } else if (typeof result === "object") {
        const rec = result as Record<string, unknown>;
        for (const key of ["name", "canonical_name"]) {
          const val = rec[key];
          if (typeof val === "string" && val) entities.add(val);
        }
        // Check nodes in subgraph results
        const nodes = rec.nodes;
        if (Array.isArray(nodes)) {
          for (const node of nodes) {
            if (node && typeof node === "object") {
              const nodeRec = node as Record<string, unknown>;
              const props = (nodeRec.props ?? nodeRec) as Record<string, unknown>;
              for (const key of ["name", "canonical_name"]) {
                const val = props[key];
                if (typeof val === "string" && val) entities.add(val);
              }
            }
          }
        }
      }
    }

    return entities;
  }

  /**
   * Generate follow-up tool calls based on discovered entities.
   *
   * Explores entity neighborhoods by querying for:
   * - Claims about newly discovered entities
   * - Relationships of entities
   * - Evidence for high-confidence claims
   */
  static generateFollowUps(
    results: StepResult[],
    knownEntities: Set<string>,
  ): Array<{ tool: string; args: Record<string, unknown> }> {
    const followUps: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const seenQueries = new Set<string>();

    for (const r of results) {
      const result = r.result;
      if (result == null) continue;

      // If we found entities, get claims about them
      const entities = RetrieverAgent.extractEntities([r]);
      for (const ename of entities) {
        const queryKey = `claims:${ename}`;
        if (!seenQueries.has(queryKey) && r.tool !== "get_claims_about") {
          followUps.push({
            tool: "get_claims_about",
            args: { entity_name: ename },
          });
          seenQueries.add(queryKey);
        }

        // Also explore entity relationships
        const relKey = `relationships:${ename}`;
        if (!seenQueries.has(relKey)) {
          followUps.push({
            tool: "find_related_entities",
            args: { entity_name: ename, depth: 1 },
          });
          seenQueries.add(relKey);
        }
      }

      // If we found claims, trace evidence for high-confidence ones
      if (Array.isArray(result)) {
        for (const item of result) {
          if (item && typeof item === "object") {
            const rec = item as Record<string, unknown>;
            const claimId = rec.claim_id;
            const confidence = typeof rec.confidence === "number" ? rec.confidence : 0;
            if (claimId && confidence > 0.7) {
              const evKey = `evidence:${claimId}`;
              if (!seenQueries.has(evKey)) {
                followUps.push({
                  tool: "find_evidence_for_claim",
                  args: { claim_id: claimId },
                });
                seenQueries.add(evKey);
              }
            }
          }
        }
      }
    }

    // Limit follow-ups per round
    return followUps.slice(0, 10);
  }
}
