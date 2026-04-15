/**
 * Helpers for safely parsing JSON coming from an LLM response.
 *
 * Why this exists
 * ---------------
 * LLMs occasionally return malformed JSON, extra prose around the JSON,
 * or JSON with the wrong shape. Scattering `JSON.parse(raw)` calls across
 * the codebase means a single bad response either crashes a request or —
 * worse — is silently swallowed by `catch {}`, losing data without any
 * signal to operators.
 *
 * This module provides one consistent entry point that always logs the
 * truncated raw output on failure, so parsing problems stay debuggable.
 *
 * Kept dependency-free on purpose (no zod): validation is expressed via
 * a user-supplied type guard so downstream packages don't need to add a
 * new runtime dep just to harden a handful of call sites.
 */

const DEFAULT_RAW_SNIPPET = 500;

export interface SafeParseOptions<T> {
  /** Contextual label included in warn logs, e.g. "analyst" or "planner". */
  context: string;
  /** Optional shape check. Return true if `value` has the expected shape. */
  validate?: (value: unknown) => value is T;
  /** How many chars of `raw` to include in the warn log on failure. */
  snippetLength?: number;
}

/**
 * Parse JSON coming from an LLM. Returns `null` on failure after logging
 * a truncated snippet of the raw output — callers decide the fallback.
 */
export function safeParseLlmJson<T = unknown>(
  raw: string,
  opts: SafeParseOptions<T>,
): T | null {
  const snippetLength = opts.snippetLength ?? DEFAULT_RAW_SNIPPET;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[llm-json:${opts.context}] JSON.parse failed: ${
        (err as Error).message
      }. Raw (first ${snippetLength} chars): ${raw.slice(0, snippetLength)}`,
    );
    return null;
  }

  if (opts.validate && !opts.validate(parsed)) {
    console.warn(
      `[llm-json:${opts.context}] validation failed. Raw (first ${snippetLength} chars): ${raw.slice(0, snippetLength)}`,
    );
    return null;
  }

  return parsed as T;
}

/** Guard: value is a plain object (not null, not array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
