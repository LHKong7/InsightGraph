export type BackendMode = "source" | "binary";

export interface InsightGraphElectronConfig {
  /** "source" requires Python+uv; "binary" uses a pre-packaged executable. */
  mode: BackendMode;

  /** Source mode: absolute path to the InsightGraph python/ directory. */
  pythonDir?: string;

  /** Binary mode: absolute path to the insightgraph-server executable. */
  binaryPath?: string;

  /** FastAPI listen host. @default "127.0.0.1" */
  apiHost?: string;

  /** FastAPI listen port. @default 8000 */
  apiPort?: number;

  /** Neo4j bolt port (for Docker). @default 7687 */
  neo4jPort?: number;

  /** Redis port (for Docker). @default 6379 */
  redisPort?: number;

  /**
   * Environment variables passed to the backend process.
   * Use IG_ prefix for InsightGraph settings.
   * @example { IG_LLM_API_KEY: "sk-xxx", IG_DOMAIN: "stock_analysis" }
   */
  env?: Record<string, string>;

  /** Whether to start Neo4j + Redis via Docker Compose. @default false */
  startDocker?: boolean;

  /** Path to docker-compose.yml. Defaults to {pythonDir}/docker-compose.yml */
  dockerComposePath?: string;

  /** Max time (ms) to wait for the backend health check. @default 30000 */
  healthCheckTimeout?: number;

  /** Interval (ms) between health check attempts. @default 1000 */
  healthCheckInterval?: number;
}

export interface ResolvedConfig {
  mode: BackendMode;
  pythonDir: string;
  binaryPath: string;
  apiHost: string;
  apiPort: number;
  neo4jPort: number;
  redisPort: number;
  env: Record<string, string>;
  startDocker: boolean;
  dockerComposePath: string;
  healthCheckTimeout: number;
  healthCheckInterval: number;
}

export function resolveConfig(
  cfg: InsightGraphElectronConfig,
): ResolvedConfig {
  return {
    mode: cfg.mode,
    pythonDir: cfg.pythonDir ?? "",
    binaryPath: cfg.binaryPath ?? "",
    apiHost: cfg.apiHost ?? "127.0.0.1",
    apiPort: cfg.apiPort ?? 8000,
    neo4jPort: cfg.neo4jPort ?? 7687,
    redisPort: cfg.redisPort ?? 6379,
    env: cfg.env ?? {},
    startDocker: cfg.startDocker ?? false,
    dockerComposePath:
      cfg.dockerComposePath ??
      (cfg.pythonDir ? `${cfg.pythonDir}/docker-compose.yml` : ""),
    healthCheckTimeout: cfg.healthCheckTimeout ?? 30_000,
    healthCheckInterval: cfg.healthCheckInterval ?? 1_000,
  };
}
