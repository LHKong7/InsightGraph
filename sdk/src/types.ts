// ============================================================
// InsightGraph TypeScript SDK — Type Definitions
// Maps to the Python Pydantic models in insightgraph_core
// ============================================================

// --- Entity types ---

export interface Entity {
  entity_id: string;
  name: string;
  canonical_name?: string;
  entity_type: string;
  description?: string;
  aliases?: string[];
}

export interface EntitySearchResult {
  entity: Entity;
  score?: number;
}

// --- Claims ---

export type ClaimType =
  | "FACTUAL"
  | "OPINION"
  | "PREDICTION"
  | "COMPARISON"
  | "RECOMMENDATION"
  | "CAUSAL";

export interface Claim {
  claim_id: string;
  text: string;
  claim_type?: ClaimType;
  confidence?: number;
  polarity?: string;
}

// --- Metrics ---

export interface Metric {
  metric_id: string;
  name: string;
  unit?: string;
  domain?: string;
}

export interface MetricValue {
  value_id: string;
  value: number;
  unit?: string;
  period?: string;
  context?: string;
}

export interface MetricHistoryRow {
  metric_value: MetricValue;
  metric: Metric;
  entity?: Entity;
}

// --- Evidence ---

export interface SourceSpan {
  span_id: string;
  text: string;
  page: number;
  start_char?: number;
  end_char?: number;
  block_id?: string;
}

// --- Reports ---

export interface Report {
  report_id: string;
  title: string;
  source_filename: string;
  date?: string;
  num_pages?: number;
  domain?: string;
  language?: string;
}

// --- Graph / Subgraph ---

export interface GraphNode {
  id: string;
  labels: string[];
  props: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  type: string;
  startId: string;
  endId: string;
  props: Record<string, any>;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Search ---

export type SearchMode = "hybrid" | "vector" | "graph";

export interface SearchRequest {
  query: string;
  top_k?: number;
  mode?: SearchMode;
  report_id?: string;
}

export interface SearchResult {
  text?: string;
  score?: number;
  result_type?: string;
  source?: string;
  rrf_score?: number;
  page?: number;
  section_title?: string;
  report_title?: string;
  report_id?: string;
  paragraph_id?: string;
  claim_id?: string;
  claim_type?: string;
  entities?: Entity[];
  evidence?: SourceSpan[];
  [key: string]: any;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

// --- Retrieval ---

export interface RetrieveRequest {
  question: string;
  top_k?: number;
  include_evidence?: boolean;
}

export interface RetrievalResult {
  paragraphs: SearchResult[];
  claims: SearchResult[];
  entities: SearchResult[];
  metrics: MetricHistoryRow[];
  sources: Array<{
    key: string;
    source: string;
    rrf_score: number;
    result_type: string;
  }>;
}

// --- Agent ---

export interface AgentQueryRequest {
  question: string;
  report_id?: string;
  session_id?: string;
}

export interface AgentResponse {
  answer: string;
  key_findings: string[];
  evidence: Array<{ text?: string; page?: number; claim_id?: string }>;
  confidence: number;
  verified: boolean;
  question_type: string;
  steps_executed: number;
}

// --- Sessions ---

export interface Session {
  session_id: string;
  created_at: string;
  turn_count?: number;
  turns?: Array<{
    question: string;
    answer: string;
    key_findings: string[];
    entities_found: string[];
    timestamp: string;
  }>;
}

// --- Ingestion ---

export type IngestionStatus =
  | "pending"
  | "parsing"
  | "extracting"
  | "resolving"
  | "writing"
  | "completed"
  | "failed";

export interface IngestionResult {
  task_id: string;
  report_id: string;
  status: IngestionStatus;
  source_type: string;
}

export interface ReportStatus {
  report_id: string;
  task_id: string;
  status: IngestionStatus;
  error?: string;
}

// --- Entity Profile ---

export interface EntityProfile {
  entity: Entity;
  claims: Array<{
    claim_id: string;
    text: string;
    type?: string;
    confidence?: number;
  }>;
  evidence: SourceSpan[];
  metrics: Array<{
    value: number;
    unit?: string;
    period?: string;
    metric_name: string;
  }>;
  related_entities: Array<{
    name: string;
    type: string;
    relationship: string;
  }>;
  reports: Array<{ report_id: string; title: string }>;
}

// --- Cross-report ---

export interface MetricTrend {
  entity_name: string;
  metric_name: string;
  values: Array<{
    value: number;
    unit?: string;
    period?: string;
    metric_name: string;
  }>;
  trend: "increasing" | "decreasing" | "stable" | "unknown";
  data_points: number;
}

export interface Contradiction {
  claim_a: string;
  claim_b: string;
  explanation: string;
}

// --- SDK Config ---

export interface InsightGraphConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}
