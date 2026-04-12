// Config
export {
  getSettings,
  setSettings,
  createSettings,
  resetSettings,
} from "./config";
export type { Settings } from "./config";

// Types
export {
  BUILTIN_ENTITY_TYPES,
  CLAIM_TYPES,
} from "./types";
export type {
  ClaimType,
  MetricDomain,
  IngestionStatus,
  BlockType,
} from "./types";

// IR Models
export {
  createBlock,
  createSectionNode,
  createDocumentIR,
  iterTextBlocks,
  iterAllBlocks,
  fullText,
} from "./ir/models";
export type {
  SourceSpan,
  TableCell,
  Block,
  TableBlock,
  SectionNode,
  DocumentIR,
} from "./ir/models";

// Extraction types
export type {
  ExtractedEntity,
  ExtractedMetric,
  ExtractedClaim,
  ExtractedRelationship,
  ResolvedEntity,
  ExtractionResult,
} from "./ir/extraction";

// Domain
export {
  STOCK_DOMAIN,
  RESTAURANT_DOMAIN,
  DEFAULT_DOMAIN,
  loadDomainConfig,
} from "./domain";
export type { DomainConfig } from "./domain";

// Ontology
export { loadOntology } from "./ontology/loader";
export {
  getNode,
  getEdge,
  nodeNames,
  edgeNames,
} from "./ontology/schema";
export type {
  PropertyDef,
  ConstraintDef,
  IndexDef,
  NodeTypeDef,
  EdgeTypeDef,
  Ontology,
} from "./ontology/schema";

// LLM
export { createLLMClient, chatJSON } from "./llm";
export type { LLMClient, ChatCompletionMessageParam } from "./llm";
