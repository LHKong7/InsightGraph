/**
 * Shared options for extractor classes. Defaults come from env vars
 * (`IG_EXTRACTION_BATCH_SIZE`, `IG_EXTRACTION_MAX_CONCURRENCY`) via the
 * Settings object; callers in `build-graph.ts` pass those through.
 *
 * `batchSize` is the number of source blocks combined into one LLM call.
 * Larger = fewer calls + more tokens + risk of the model missing entities.
 * `maxConcurrency` bounds how many LLM calls are in flight per extractor.
 * Keep below your provider's rate limit per minute divided by avg call latency.
 */
export interface ExtractorOptions {
  batchSize?: number;
  maxConcurrency?: number;
}

export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_MAX_CONCURRENCY = 4;
