const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    // Don't surface the raw response body to the UI — server errors can leak
    // stack traces, internal paths, or env values. Log the detail to the
    // browser console for debugging, and throw a generic status-only error.
    const body = await res.text().catch(() => "");
    if (body) console.error(`API ${res.status} ${path}:`, body);
    throw new Error(`API ${res.status}`);
  }
  return res.json();
}

// --- Entities ---
export async function searchEntities(q: string, type?: string, limit = 50) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (type) params.set("type", type);
  return fetchJSON<{ entities: any[]; count: number }>(
    `/api/v1/entities/search?${params}`
  );
}

export async function getEntity(entityId: string) {
  return fetchJSON<any>(`/api/v1/entities/${entityId}`);
}

export async function getEntityClaims(entityId: string) {
  return fetchJSON<{ claims: any[]; count: number }>(
    `/api/v1/entities/${entityId}/claims`
  );
}

export async function getEntityMetrics(entityId: string) {
  return fetchJSON<{ metrics: any[]; count: number }>(
    `/api/v1/entities/${entityId}/metrics`
  );
}

// --- Claims ---
export async function getClaimEvidence(claimId: string) {
  return fetchJSON<{ evidence: any[]; count: number }>(
    `/api/v1/claims/${claimId}/evidence`
  );
}

// --- Subgraph ---
export async function getSubgraph(query: string) {
  return fetchJSON<{ nodes: any[]; edges: any[] }>(
    `/api/v1/subgraph/question?q=${encodeURIComponent(query)}`
  );
}

// --- Search ---
export async function searchDocuments(
  query: string,
  mode: "hybrid" | "vector" | "graph" = "hybrid",
  topK = 10
) {
  return fetchJSON<{ results: any[]; total: number }>(`/api/v1/search`, {
    method: "POST",
    body: JSON.stringify({ query, mode, top_k: topK }),
  });
}

// --- Agent ---
export async function agentQuery(question: string, sessionId?: string) {
  return fetchJSON<{
    answer: string;
    key_findings: string[];
    evidence: any[];
    confidence: number;
    verified: boolean;
    question_type: string;
    steps_executed: number;
  }>(`/api/v1/agent/query`, {
    method: "POST",
    body: JSON.stringify({ question, session_id: sessionId }),
  });
}

export async function createSession() {
  return fetchJSON<{ session_id: string }>(`/api/v1/sessions`, {
    method: "POST",
  });
}

// --- Reports ---
export async function listReports() {
  return fetchJSON<{ reports: any[]; count: number }>(`/api/v1/reports`);
}

export async function getReportGraph(reportId: string, depth = 3) {
  return fetchJSON<{ nodes: any[]; edges: any[] }>(
    `/api/v1/reports/${reportId}/graph?depth=${depth}`
  );
}

export async function uploadReport(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/reports/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (body) console.error(`Upload ${res.status}:`, body);
    throw new Error(`Upload failed: ${res.status}`);
  }
  return res.json();
}

// --- Jobs (graph-builder pipeline) ---
export interface JobInfo {
  task_id: string;
  report_id: string;
  status: string;
  source_type: string;
  error?: string;
  result?: {
    entities?: number;
    metrics?: number;
    metric_values?: number;
    claims?: number;
    relationships?: number;
    edges?: number;
    paragraphs?: number;
    sections?: number;
    reports?: number;
    source_spans?: number;
  };
}

export async function listJobs(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchJSON<{
    summary: { total: number; active: number; completed: number; failed: number };
    jobs: JobInfo[];
  }>(`/api/v1/jobs${qs}`);
}

export async function getReportStatus(reportId: string) {
  return fetchJSON<{
    report_id: string;
    task_id: string;
    status: string;
    error?: string;
    result?: JobInfo["result"];
  }>(`/api/v1/reports/${reportId}/status`);
}
