import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  createSettings,
  loadDomainConfig,
} from "@insightgraph/core";
import type {
  Settings,
  DomainConfig,
} from "@insightgraph/core";
import {
  Neo4jConnection,
  ensureSchema,
  GraphReader,
} from "@insightgraph/graph";
import {
  GraphRetriever,
  AgentTools,
  CrossReportAnalyzer,
} from "@insightgraph/retriever";
import {
  Orchestrator,
  SessionManager,
} from "@insightgraph/agent-runtime";
import { runPipeline } from "./pipeline";
import { flattenConfig } from "./types";
import type {
  SdkConfig,
  IngestOptions,
  IngestResult,
  ProgressEvent,
} from "./types";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".json",
  ".md",
  ".markdown",
  ".xlsx",
  ".xls",
]);

/**
 * High-level embeddable facade for the InsightGraph pipeline.
 *
 * Use this class to ingest documents and query the resulting knowledge graph
 * directly from an Electron main process, a Node.js server, or any other
 * in-process consumer. No HTTP, no child process.
 *
 * @example
 * ```ts
 * const ig = new InsightGraph({
 *   neo4j: { uri: "bolt://localhost:7687", user: "neo4j", password: "..." },
 *   llm:   { model: "gpt-4o-mini", apiKey: process.env.OPENAI_KEY },
 * });
 * await ig.initialize();
 * ig.on("progress", (ev) => console.log(ev.stage));
 * const { reportId } = await ig.ingest({ filePath: "/path/to/report.pdf" });
 * const entities  = await ig.findEntities({ name: "NVIDIA" });
 * const answer    = await ig.agentQuery("What drove the stock price?");
 * await ig.close();
 * ```
 */
export class InsightGraph extends EventEmitter {
  private _settings: Settings;
  private _domainConfig: DomainConfig;
  private _neo4j: Neo4jConnection | null = null;
  private _reader: GraphReader | null = null;
  private _sessionManager: SessionManager | null = null;

  constructor(config: SdkConfig = {}) {
    super();
    this._settings = createSettings(flattenConfig(config));
    this._domainConfig =
      typeof config.domain === "object" && config.domain !== null
        ? config.domain
        : loadDomainConfig(this._settings.domain);
  }

  /** Effective Settings after applying overrides and env defaults. */
  get settings(): Settings {
    return this._settings;
  }

  /** The resolved DomainConfig used for extraction prompts. */
  get domain(): DomainConfig {
    return this._domainConfig;
  }

  /**
   * Connect to Neo4j, ensure the graph schema, and warm internal helpers.
   * Call once at startup before any other method.
   */
  async initialize(): Promise<void> {
    if (this._neo4j) return; // idempotent

    const conn = new Neo4jConnection(
      this._settings.neo4jUri,
      this._settings.neo4jUser,
      this._settings.neo4jPassword,
    );

    try {
      await conn.verifyConnectivity();
    } catch (err) {
      // Don't throw — the connection may still work for queries even if
      // verifyConnectivity() reports stale auth. Surface a warning to the caller.
      this.emit(
        "warning",
        `Neo4j connectivity check failed: ${(err as Error).message}`,
      );
    }

    try {
      await ensureSchema(conn);
    } catch (err) {
      this.emit(
        "warning",
        `Could not ensure graph schema: ${(err as Error).message}`,
      );
    }

    this._neo4j = conn;
    this._reader = new GraphReader(conn);
    this._sessionManager = new SessionManager();
  }

  /** Close the Neo4j driver. Call once at shutdown. */
  async close(): Promise<void> {
    if (this._neo4j) {
      await this._neo4j.close();
      this._neo4j = null;
      this._reader = null;
    }
  }

  // --------------------------------------------------------------------
  // Ingestion
  // --------------------------------------------------------------------

  /**
   * Full pipeline: stage the file, parse → extract → resolve → write graph.
   * Emits `progress` (and per-stage events `parsing`/`extracting`/`resolving`/
   * `writing`/`completed`) as it runs.
   */
  async ingest(opts: IngestOptions): Promise<IngestResult> {
    this._assertReady();

    const reportId = randomUUID();
    const stagedPath = await this._stageFile(opts, reportId);

    const emit = (ev: ProgressEvent) => {
      this.emit("progress", ev);
      this.emit(ev.stage, ev);
    };

    try {
      const result = await runPipeline(stagedPath, reportId, this._settings, {
        emit,
        neo4j: this._neo4j!,
        domainConfig: this._domainConfig,
      });
      return { reportId, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ stage: "failed", reportId, error: message });
      throw err;
    }
  }

  private async _stageFile(opts: IngestOptions, reportId: string): Promise<string> {
    const filename = "filename" in opts && opts.filename ? opts.filename : undefined;

    if ("filePath" in opts) {
      const ext = extname(filename ?? opts.filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported file extension: ${ext}`);
      }
      return opts.filePath;
    }

    // buffer + filename branch
    const ext = extname(opts.filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported file extension: ${ext}`);
    }
    const uploadDir = this._settings.uploadDir;
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    const stagedPath = join(uploadDir, `${reportId}${ext}`);
    const buf =
      opts.buffer instanceof Buffer ? opts.buffer : Buffer.from(opts.buffer);
    writeFileSync(stagedPath, buf);
    return stagedPath;
  }

  // --------------------------------------------------------------------
  // Graph queries
  // --------------------------------------------------------------------

  async findEntities(query: {
    name?: string;
    type?: string;
    limit?: number;
  } = {}) {
    this._assertReady();
    return this._reader!.findEntities(query.name, query.type, query.limit ?? 50);
  }

  async getEntity(entityId: string) {
    this._assertReady();
    return this._reader!.getEntity(entityId);
  }

  async getEntityProfile(entityName: string) {
    this._assertReady();
    return this._reader!.getEntityFullProfile(entityName);
  }

  async getClaimsAbout(entityName: string) {
    this._assertReady();
    return this._reader!.getClaimsAbout(entityName);
  }

  async getEntityMetrics(entityName: string) {
    this._assertReady();
    return this._reader!.getEntityMetrics(entityName);
  }

  async getMetricHistory(metricName: string, entityName?: string) {
    this._assertReady();
    return this._reader!.getMetricHistory(metricName, entityName);
  }

  async findEvidenceForClaim(claimId: string) {
    this._assertReady();
    return this._reader!.findEvidenceForClaim(claimId);
  }

  async getSubgraph(nodeId: string, depth = 2) {
    this._assertReady();
    return this._reader!.getSubgraph(nodeId, depth);
  }

  async listReports() {
    this._assertReady();
    return this._reader!.listReports();
  }

  async getReport(reportId: string) {
    this._assertReady();
    return this._reader!.getReport(reportId);
  }

  async getEntityRelationships(entityName: string) {
    this._assertReady();
    return this._reader!.getEntityRelationships(entityName);
  }

  async findPath(entityA: string, entityB: string, maxDepth = 4) {
    this._assertReady();
    return this._reader!.findPath(entityA, entityB, maxDepth);
  }

  async compareEntityAcrossReports(entityName: string) {
    this._assertReady();
    return this._reader!.getCrossReportEntity(entityName);
  }

  async findMetricTrend(entityName: string, metricName: string) {
    this._assertReady();
    const analyzer = new CrossReportAnalyzer(this._reader!);
    return analyzer.findMetricTrend(entityName, metricName);
  }

  async findContradictions(entityName: string) {
    this._assertReady();
    const analyzer = new CrossReportAnalyzer(
      this._reader!,
      this._settings.llmModel,
      this._settings.llmApiKey,
      this._settings.llmBaseUrl || undefined,
    );
    return analyzer.findContradictions(entityName);
  }

  async entityTimeline(entityName: string) {
    this._assertReady();
    const analyzer = new CrossReportAnalyzer(this._reader!);
    return analyzer.entityTimeline(entityName);
  }

  // --------------------------------------------------------------------
  // Agent RAG
  // --------------------------------------------------------------------

  /**
   * Run the full agent pipeline (Planner → RetrieverAgent → Analyst → Verifier)
   * to answer a natural-language question against the knowledge graph.
   */
  async agentQuery(question: string, sessionId?: string) {
    this._assertReady();
    const retriever = new GraphRetriever(this._reader!);
    const tools = new AgentTools(retriever);
    const orchestrator = new Orchestrator(
      tools,
      this._settings.llmModel,
      this._settings.llmApiKey,
      this._settings.llmBaseUrl || undefined,
    );
    return orchestrator.query(question, sessionId);
  }

  /** Create a new agent session and return its id. */
  createSession(): string {
    this._assertReady();
    return this._sessionManager!.createSession().sessionId;
  }

  getSession(sessionId: string) {
    this._assertReady();
    return this._sessionManager!.getSession(sessionId);
  }

  deleteSession(sessionId: string) {
    this._assertReady();
    this._sessionManager!.deleteSession(sessionId);
  }

  // --------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------

  private _assertReady(): void {
    if (!this._neo4j || !this._reader) {
      throw new Error(
        "InsightGraph has not been initialized — call `await ig.initialize()` first.",
      );
    }
  }
}
