import { config } from "dotenv";

// Load .env file from the working directory
config();

export interface Settings {
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

/** Build a Settings object from env vars (no cache). */
function envDefaults(): Settings {
  return {
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
