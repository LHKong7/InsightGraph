import type { DomainConfig, Settings } from "@insightgraph/core";

/**
 * User-friendly config for the embedded SDK.
 * All fields are optional; anything omitted falls back to the `IG_*` env var
 * defaults used by the rest of the InsightGraph stack.
 */
export interface SdkConfig {
  neo4j?: {
    uri?: string;
    user?: string;
    password?: string;
  };
  llm?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  /** Built-in domain name ("default", "stock_analysis", "restaurant_analysis") or a full DomainConfig object. */
  domain?: string | DomainConfig;
  /** Directory where uploaded files are staged before parsing. */
  uploadDir?: string;
  extraction?: {
    batchSize?: number;
    maxConcurrency?: number;
  };
}

/** Options for {@link InsightGraph.ingest}. */
export type IngestOptions =
  | {
      /** Absolute path to an existing file on disk. */
      filePath: string;
      /** Optional override; otherwise the extension is derived from filePath. */
      filename?: string;
    }
  | {
      /** In-memory file contents (e.g. from an Electron drag-and-drop). */
      buffer: Buffer | Uint8Array;
      /** Original filename — its extension determines which parser is used. */
      filename: string;
    };

/** Counts returned after a successful pipeline run. */
export interface IngestResult {
  reportId: string;
  reports: number;
  sections: number;
  paragraphs: number;
  source_spans: number;
  entities: number;
  metrics: number;
  metric_values: number;
  claims: number;
  relationships: number;
  edges: number;
}

/** Event emitted as the pipeline progresses through its stages. */
export interface ProgressEvent {
  stage:
    | "parsing"
    | "extracting"
    | "resolving"
    | "writing"
    | "completed"
    | "failed";
  reportId: string;
  /** Additional stage-specific fields (section count, entity count, error message, ...). */
  [key: string]: unknown;
}

/** Internal helper: flatten nested {@link SdkConfig} into a Settings overrides object. */
export function flattenConfig(cfg: SdkConfig): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (cfg.neo4j?.uri) out.neo4jUri = cfg.neo4j.uri;
  if (cfg.neo4j?.user) out.neo4jUser = cfg.neo4j.user;
  if (cfg.neo4j?.password) out.neo4jPassword = cfg.neo4j.password;
  if (cfg.llm?.model) out.llmModel = cfg.llm.model;
  if (cfg.llm?.apiKey) out.llmApiKey = cfg.llm.apiKey;
  if (cfg.llm?.baseUrl) out.llmBaseUrl = cfg.llm.baseUrl;
  if (cfg.uploadDir) out.uploadDir = cfg.uploadDir;
  if (cfg.extraction?.batchSize != null) out.extractionBatchSize = cfg.extraction.batchSize;
  if (cfg.extraction?.maxConcurrency != null) out.extractionMaxConcurrency = cfg.extraction.maxConcurrency;
  if (typeof cfg.domain === "string") out.domain = cfg.domain;
  return out;
}
