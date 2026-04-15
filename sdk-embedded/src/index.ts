// High-level facade
export { InsightGraph } from "./insightgraph";

// Library-level pipeline runner (call without the class if you manage your own lifecycle)
export { runPipeline } from "./pipeline";

// SDK-specific types
export type {
  SdkConfig,
  IngestOptions,
  IngestResult,
  ProgressEvent,
} from "./types";

// -------------------------------------------------------------------------
// Low-level re-exports for power users who want to compose their own pipeline
// -------------------------------------------------------------------------

// Core config + IR
export {
  createSettings,
  getSettings,
  setSettings,
  resetSettings,
  loadDomainConfig,
  STOCK_DOMAIN,
  RESTAURANT_DOMAIN,
  DEFAULT_DOMAIN,
  loadOntology,
} from "@insightgraph/core";
export type {
  Settings,
  DomainConfig,
  DocumentIR,
  Block,
  SectionNode,
  SourceSpan,
  ExtractionResult,
  ExtractedEntity,
  ExtractedClaim,
  ExtractedMetric,
  ExtractedRelationship,
  ResolvedEntity,
  Ontology,
} from "@insightgraph/core";

// Parsing
export {
  ParserService,
  PdfParser,
  CsvParser,
  JsonParser,
  MarkdownParser,
  XlsxParser,
} from "@insightgraph/parser";

// Extraction
export {
  ExtractionPipeline,
  EntityExtractor,
  MetricExtractor,
  ClaimExtractor,
  RelationshipExtractor,
} from "@insightgraph/extractor";

// Resolution
export {
  ResolverService,
  EntityResolver,
} from "@insightgraph/resolver";

// Graph — backend-agnostic primitives (preferred for new code)
export {
  createGraphStore,
  Neo4jGraphStore,
  SqliteGraphStore,
  FalkorGraphStore,
  DEFAULT_MERGE_POLICY,
  UnsupportedBackendError,
} from "@insightgraph/graph";
export type {
  GraphStore,
  IGraphReader,
  IGraphWriter,
  GraphBackend,
  GraphDumpChunk,
  ImportStats,
  MergePolicy,
} from "@insightgraph/graph";

// Graph — Neo4j-specific primitives (legacy; still exported for one release)
export {
  Neo4jConnection,
  ensureSchema,
  GraphReader,
  GraphWriter,
  toPlainObject,
} from "@insightgraph/graph";

// Retrieval + tools
export {
  GraphRetriever,
  HybridRetriever,
  CrossReportAnalyzer,
  GraphAnalytics,
  AgentTools,
} from "@insightgraph/retriever";
export type { RetrievalResult, ToolDefinition } from "@insightgraph/retriever";

// Agent runtime
export {
  Orchestrator,
  Planner,
  Analyst,
  Verifier,
  RetrieverAgent,
  SessionManager,
} from "@insightgraph/agent-runtime";
