import type {
  InsightGraphConfig,
  SearchRequest,
  SearchResponse,
  RetrieveRequest,
  RetrievalResult,
  AgentQueryRequest,
  AgentResponse,
  Session,
  IngestionResult,
  ReportStatus,
  Report,
  Entity,
  EntityProfile,
  MetricHistoryRow,
  MetricTrend,
  Contradiction,
  Subgraph,
  SourceSpan,
} from "./types";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * InsightGraph TypeScript SDK Client.
 *
 * Provides typed access to all InsightGraph REST API endpoints.
 *
 * @example
 * ```ts
 * import { InsightGraphClient } from "insightgraph-sdk";
 *
 * const client = new InsightGraphClient({ baseUrl: "http://localhost:8000" });
 * const results = await client.search({ query: "revenue growth" });
 * const answer = await client.agentQuery({ question: "What drove growth?" });
 * ```
 */
export class InsightGraphClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(config: InsightGraphConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeout = config.timeout ?? 30000;
    this.headers = { "Content-Type": "application/json", ...config.headers };
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  private async fetch<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers, ...init?.headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, `API ${res.status}: ${text}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.fetch<T>(path);
  }

  private post<T>(path: string, body: any): Promise<T> {
    return this.fetch<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ---------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------

  /** Check service health. */
  async health(): Promise<{ status: string; neo4j: string }> {
    return this.get("/health");
  }

  // ---------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------

  /** Upload a file for ingestion. */
  async uploadReport(file: Blob, filename: string): Promise<IngestionResult> {
    const form = new FormData();
    form.append("file", file, filename);
    const res = await fetch(`${this.baseUrl}/api/v1/reports/upload`, {
      method: "POST",
      body: form,
      headers: { ...this.headers, "Content-Type": undefined as any },
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  /** Trigger parsing. */
  async parseReport(reportId: string): Promise<{ task_id: string; status: string }> {
    return this.post(`/api/v1/reports/${reportId}/parse`, {});
  }

  /** Trigger graph building. */
  async buildGraph(reportId: string): Promise<{ task_id: string; status: string }> {
    return this.post(`/api/v1/reports/${reportId}/build-graph`, {});
  }

  /** Check ingestion status. */
  async getReportStatus(reportId: string): Promise<ReportStatus> {
    return this.get(`/api/v1/reports/${reportId}/status`);
  }

  /** Trigger embedding backfill. */
  async embedReport(
    reportId: string,
  ): Promise<{ paragraphs_embedded: number; claims_embedded: number }> {
    return this.post(`/api/v1/reports/${reportId}/embed`, {});
  }

  // ---------------------------------------------------------------
  // Search & Retrieval
  // ---------------------------------------------------------------

  /** Hybrid / vector / graph search. */
  async search(req: SearchRequest): Promise<SearchResponse> {
    return this.post("/api/v1/search", {
      query: req.query,
      top_k: req.top_k ?? 10,
      mode: req.mode ?? "hybrid",
      report_id: req.report_id,
    });
  }

  /** Structured RAG retrieval. */
  async retrieve(req: RetrieveRequest): Promise<RetrievalResult> {
    return this.post("/api/v1/retrieve", {
      question: req.question,
      top_k: req.top_k ?? 10,
      include_evidence: req.include_evidence ?? true,
    });
  }

  // ---------------------------------------------------------------
  // Graph Query
  // ---------------------------------------------------------------

  /** Search entities by name and optional type. */
  async searchEntities(
    q: string,
    type?: string,
    limit = 50,
  ): Promise<{ entities: any[]; count: number }> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (type) params.set("type", type);
    return this.get(`/api/v1/entities/search?${params}`);
  }

  /** Get entity by ID. */
  async getEntity(entityId: string): Promise<Entity> {
    return this.get(`/api/v1/entities/${entityId}`);
  }

  /** Get claims about an entity. */
  async getEntityClaims(
    entityId: string,
  ): Promise<{ entity_id: string; claims: any[]; count: number }> {
    return this.get(`/api/v1/entities/${entityId}/claims`);
  }

  /** Get metrics for an entity. */
  async getEntityMetrics(
    entityId: string,
    metricName?: string,
  ): Promise<{ entity_id: string; metrics: MetricHistoryRow[]; count: number }> {
    const params = metricName ? `?metric_name=${encodeURIComponent(metricName)}` : "";
    return this.get(`/api/v1/entities/${entityId}/metrics${params}`);
  }

  /** Get evidence for a claim. */
  async getClaimEvidence(
    claimId: string,
  ): Promise<{ claim_id: string; evidence: SourceSpan[]; count: number }> {
    return this.get(`/api/v1/claims/${claimId}/evidence`);
  }

  /** Get subgraph for a question. */
  async getSubgraph(q: string): Promise<Subgraph> {
    return this.get(`/api/v1/subgraph/question?q=${encodeURIComponent(q)}`);
  }

  /** List all reports. */
  async listReports(): Promise<{ reports: Report[]; count: number }> {
    return this.get("/api/v1/reports");
  }

  /** Get a report by ID. */
  async getReport(reportId: string): Promise<Report> {
    return this.get(`/api/v1/reports/${reportId}`);
  }

  // ---------------------------------------------------------------
  // Agent
  // ---------------------------------------------------------------

  /** Run a question through the full agent pipeline. */
  async agentQuery(req: AgentQueryRequest): Promise<AgentResponse> {
    return this.post("/api/v1/agent/query", req);
  }

  // ---------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------

  /** Create a new conversation session. */
  async createSession(): Promise<{ session_id: string; created_at: string }> {
    return this.post("/api/v1/sessions", {});
  }

  /** Get session history. */
  async getSession(sessionId: string): Promise<Session> {
    return this.get(`/api/v1/sessions/${sessionId}`);
  }

  /** Delete a session. */
  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return this.fetch(`/api/v1/sessions/${sessionId}`, { method: "DELETE" });
  }

  /** List all active sessions. */
  async listSessions(): Promise<{ sessions: Session[]; count: number }> {
    return this.get("/api/v1/sessions");
  }
}
