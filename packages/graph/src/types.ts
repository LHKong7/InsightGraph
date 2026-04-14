import type {
  DocumentIR,
  ExtractionResult,
  Ontology,
} from "@insightgraph/core";

/**
 * Backend-agnostic reader interface.
 * Both the Neo4j and SQLite implementations satisfy this contract.
 */
export interface GraphReader {
  findEntities(
    name?: string,
    entityType?: string,
    limit?: number,
  ): Promise<Record<string, unknown>[]>;

  getEntity(entityId: string): Promise<Record<string, unknown> | null>;

  getClaimsAbout(entityName: string): Promise<Record<string, unknown>[]>;

  findEvidenceForClaim(claimId: string): Promise<Record<string, unknown>[]>;

  getEntityMetrics(entityName: string): Promise<Record<string, unknown>[]>;

  getMetricHistory(
    metricName: string,
    entityName?: string,
  ): Promise<Record<string, unknown>[]>;

  getSubgraph(
    nodeId: string,
    depth?: number,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }>;

  getReport(reportId: string): Promise<Record<string, unknown> | null>;

  listReports(): Promise<Record<string, unknown>[]>;

  getEntityRelationships(
    entityName: string,
  ): Promise<Record<string, unknown>[]>;

  findPath(
    entityA: string,
    entityB: string,
    maxDepth?: number,
  ): Promise<{ nodes: unknown[]; edges: unknown[]; found: boolean }>;

  getEntityFullProfile(
    entityName: string,
  ): Promise<Record<string, unknown>>;

  getCrossReportEntity(
    entityName: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * Backend-agnostic writer interface.
 */
export interface GraphWriter {
  writeDocument(
    doc: DocumentIR,
    extractions: ExtractionResult,
    policy?: MergePolicy,
  ): Promise<Record<string, number>>;
}

/**
 * Streaming dump chunk used for cross-backend export/import.
 * UUIDs are stable across backends; typed nodes are identified by their
 * canonical id property (report_id, entity_id, etc.).
 */
export type GraphDumpChunk =
  | {
      kind: "node";
      label: string;
      id: string;
      props: Record<string, unknown>;
    }
  | {
      kind: "edge";
      type: string;
      sourceId: string;
      targetId: string;
      props: Record<string, unknown>;
    };

export interface ImportStats {
  nodes: number;
  edges: number;
  conflicts: number;
}

/**
 * Conflict resolution policy used when the same canonical node is seen
 * from multiple documents / graphs.
 *
 * The default values match the existing Cypher MERGE semantics at
 * packages/graph/src/writer.ts:178-181 (preferExisting description,
 * alias-union via "larger wins", preferHigher confidence).
 */
export interface MergePolicy {
  description: "preferExisting" | "overwrite" | "concat";
  confidence: "preferHigher" | "preferExisting" | "overwrite";
  aliases: "union" | "preferExisting" | "overwrite";
  edgeProps: "preferExisting" | "overwrite";
  /** If true, write a row to the `conflicts` table (SQLite backend only). */
  conflictLog?: boolean;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  description: "preferExisting",
  confidence: "preferHigher",
  aliases: "union",
  edgeProps: "preferExisting",
  conflictLog: false,
};

export type GraphBackend = "neo4j" | "sqlite" | "falkor";

/**
 * A self-contained graph store facade. Produced by `createGraphStore()` in
 * packages/graph/src/index.ts.
 */
export interface GraphStore {
  readonly kind: GraphBackend;
  reader(): GraphReader;
  writer(): GraphWriter;
  ensureSchema(ontology?: Ontology): Promise<void>;
  verifyConnectivity(): Promise<void>;
  /** Stream every node and edge in the graph (used for migration/merge). */
  exportDump(): AsyncIterable<GraphDumpChunk>;
  /** Apply a dump into this store, honoring the merge policy. */
  importDump(
    dump: AsyncIterable<GraphDumpChunk>,
    policy?: MergePolicy,
  ): Promise<ImportStats>;
  close(): Promise<void>;
}

export class UnsupportedBackendError extends Error {
  constructor(op: string, backend: GraphBackend) {
    super(`${op} is not supported on backend '${backend}'`);
    this.name = "UnsupportedBackendError";
  }
}
