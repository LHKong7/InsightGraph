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

let _cached: Settings | null = null;

export function getSettings(): Settings {
  if (_cached) return _cached;

  _cached = {
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

  return _cached;
}

/** Reset cached settings (useful for testing). */
export function resetSettings(): void {
  _cached = null;
}
