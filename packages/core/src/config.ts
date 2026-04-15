import { config } from "dotenv";

// Load .env file from the working directory
config();

export type GraphBackend = "neo4j" | "sqlite" | "falkor";

export interface Settings {
  graphBackend: GraphBackend;
  sqlitePath: string;
  /** Directory where the embedded FalkorDB persists data. */
  falkorPath: string;
  /** Name of the graph within FalkorDB (a single DB instance can host many). */
  falkorGraphName: string;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  llmModel: string;
  llmApiKey: string;
  llmBaseUrl: string;
  redisUrl: string;
  uploadDir: string;
  maxFileSizeMb: number;
  extractionBatchSize: number;
  extractionMaxConcurrency: number;
  domain: string;
  /**
   * Allowed CORS origins for the API. Empty array means "deny all cross-origin".
   * Use ["*"] to explicitly allow any origin (dev only).
   */
  corsOrigins: string[];
  /**
   * When true, the API returns generic error messages to clients and logs the
   * detailed message server-side. Defaults to true unless `IG_ENV` is "development".
   */
  safeErrorResponses: boolean;
}

function envStr(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envList(key: string, defaultValue: string[]): string[] {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw);
}

/** Build a Settings object from env vars (no cache). */
function envBackend(): GraphBackend {
  const raw = (process.env.IG_GRAPH_BACKEND ?? "neo4j").toLowerCase();
  if (raw === "sqlite" || raw === "neo4j" || raw === "falkor") return raw;
  // Unknown value — fall back to neo4j rather than crashing at import time.
  return "neo4j";
}

function envDefaults(): Settings {
  return {
    graphBackend: envBackend(),
    sqlitePath: envStr("IG_SQLITE_PATH", "./data/insightgraph.sqlite"),
    falkorPath: envStr("IG_FALKOR_PATH", "./data/falkor"),
    falkorGraphName: envStr("IG_FALKOR_GRAPH_NAME", "insightgraph"),
    neo4jUri: envStr("IG_NEO4J_URI", "bolt://localhost:7687"),
    neo4jUser: envStr("IG_NEO4J_USER", "neo4j"),
    neo4jPassword: envStr("IG_NEO4J_PASSWORD", "insightgraph"),
    llmModel: envStr("IG_LLM_MODEL", "gpt-4o-mini"),
    llmApiKey: envStr("IG_LLM_API_KEY", ""),
    llmBaseUrl: envStr("IG_LLM_BASE_URL", ""),
    redisUrl: envStr("IG_REDIS_URL", "redis://localhost:6379"),
    uploadDir: envStr("IG_UPLOAD_DIR", "/tmp/insightgraph/uploads"),
    maxFileSizeMb: envInt("IG_MAX_FILE_SIZE_MB", 100),
    extractionBatchSize: envInt("IG_EXTRACTION_BATCH_SIZE", 5),
    extractionMaxConcurrency: envInt("IG_EXTRACTION_MAX_CONCURRENCY", 5),
    domain: envStr("IG_DOMAIN", "default"),
    corsOrigins: envList("IG_CORS_ORIGINS", ["http://localhost:3000"]),
    safeErrorResponses: envBool(
      "IG_SAFE_ERROR_RESPONSES",
      (process.env.IG_ENV ?? "production").toLowerCase() !== "development",
    ),
  };
}

/**
 * Build a Settings object from env-var defaults, then apply programmatic overrides.
 * Does not touch the internal cache — callers can build ad-hoc Settings without
 * affecting other parts of the app that rely on `getSettings()`.
 */
export function createSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...envDefaults(), ...overrides };
}

let _cached: Settings | null = null;

/**
 * Return the process-wide Settings singleton, loading from env vars on first call.
 * Use `setSettings()` first to inject a programmatic config (e.g. from the SDK).
 */
export function getSettings(): Settings {
  if (_cached) return _cached;
  _cached = envDefaults();
  return _cached;
}

/** Inject a Settings singleton (overrides env). Useful for SDK consumers. */
export function setSettings(settings: Settings): void {
  _cached = settings;
}

/** Reset cached settings (useful for testing). */
export function resetSettings(): void {
  _cached = null;
}
