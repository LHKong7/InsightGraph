import { HTTPException } from "hono/http-exception";

/**
 * Shared request-parameter validators for API routes.
 *
 * Goals:
 *   - Fail fast with a 400 on clearly-bad input instead of letting NaN / `..`
 *     propagate into readers and databases (which would bubble up as
 *     generic 500s and obscure the real cause).
 *   - Keep the shape predictable: always throw HTTPException so the global
 *     onError handler can return a clean, author-controlled message.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntParamOptions {
  min?: number;
  max?: number;
  /** Returned when `raw` is undefined or "". */
  default?: number;
}

/**
 * Parse an integer query/path parameter. Always uses radix 10, rejects NaN,
 * clamps with explicit 400 if outside [min, max].
 */
export function parseIntParam(
  name: string,
  raw: string | undefined | null,
  opts: IntParamOptions = {},
): number {
  if (raw === undefined || raw === null || raw === "") {
    if (opts.default !== undefined) return opts.default;
    throw new HTTPException(400, { message: `Missing required parameter: ${name}` });
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new HTTPException(400, {
      message: `Invalid integer for parameter '${name}': '${raw}'`,
    });
  }
  if (opts.min !== undefined && parsed < opts.min) {
    throw new HTTPException(400, {
      message: `Parameter '${name}' must be >= ${opts.min}`,
    });
  }
  if (opts.max !== undefined && parsed > opts.max) {
    throw new HTTPException(400, {
      message: `Parameter '${name}' must be <= ${opts.max}`,
    });
  }
  return parsed;
}

/**
 * Validate a parameter is a UUID. Rejects anything else with a 400 — this is
 * the primary defense against path-traversal via `reportId` ending up in
 * `path.join(uploadDir, reportId)`.
 */
export function parseUuidParam(name: string, raw: string | undefined): string {
  if (!raw || !UUID_REGEX.test(raw)) {
    throw new HTTPException(400, {
      message: `Parameter '${name}' must be a UUID`,
    });
  }
  return raw;
}
