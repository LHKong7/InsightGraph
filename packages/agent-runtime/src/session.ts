import { randomUUID } from "crypto";

/**
 * A single question-answer turn in a session.
 */
export interface SessionTurn {
  question: string;
  answer: string;
  keyFindings: string[];
  entitiesFound: string[];
  timestamp: string;
}

/**
 * Maintains conversation context across multiple agent queries.
 */
export class Session {
  public readonly sessionId: string;
  public readonly turns: SessionTurn[];
  public readonly createdAt: string;

  constructor() {
    this.sessionId = randomUUID().replace(/-/g, "");
    this.turns = [];
    this.createdAt = new Date().toISOString();
  }

  addTurn(
    question: string,
    answer: string,
    keyFindings: string[] = [],
    entitiesFound: string[] = [],
  ): void {
    this.turns.push({
      question,
      answer,
      keyFindings,
      entitiesFound,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Generate a context summary for injecting into the planner prompt.
   * Summarizes recent turns so the agent knows what has already been discussed.
   */
  getContextSummary(maxTurns = 5): string {
    if (this.turns.length === 0) return "";

    const recent = this.turns.slice(-maxTurns);
    const parts: string[] = ["Previous conversation context:"];

    recent.forEach((turn, i) => {
      parts.push(`\nQ${i + 1}: ${turn.question}`);
      if (turn.keyFindings.length > 0) {
        parts.push(`Key findings: ${turn.keyFindings.slice(0, 3).join(", ")}`);
      }
      if (turn.entitiesFound.length > 0) {
        parts.push(`Entities discussed: ${turn.entitiesFound.slice(0, 5).join(", ")}`);
      }
    });

    const allEntities = new Set<string>();
    for (const turn of this.turns) {
      for (const e of turn.entitiesFound) {
        allEntities.add(e);
      }
    }
    if (allEntities.size > 0) {
      const sorted = Array.from(allEntities).sort();
      parts.push(`\nAll entities discussed so far: ${sorted.join(", ")}`);
    }

    return parts.join("\n");
  }

  toDict(): Record<string, unknown> {
    return {
      session_id: this.sessionId,
      created_at: this.createdAt,
      turn_count: this.turns.length,
      turns: this.turns.map((t) => ({
        question: t.question,
        answer: t.answer.length > 200 ? t.answer.slice(0, 200) + "..." : t.answer,
        key_findings: t.keyFindings,
        entities_found: t.entitiesFound,
        timestamp: t.timestamp,
      })),
    };
  }
}

/**
 * Manages conversation sessions. In-memory for MVP.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(): Session {
    const session = new Session();
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  listSessions(): Record<string, unknown>[] {
    return Array.from(this.sessions.values()).map((s) => s.toDict());
  }
}
