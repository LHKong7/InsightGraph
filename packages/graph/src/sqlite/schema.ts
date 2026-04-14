import type { SqliteConnection } from "./connection";

/**
 * DDL for the SQLite graph store. Mirrors the Neo4j ontology:
 *   - one typed table per core node label (Report, Entity, Metric, ...)
 *   - a single generic `edges` table
 *   - FTS5 virtual tables for Entity fulltext + Claim fulltext (matches
 *     the `entity_search` and `claim_search` fulltext indexes created by
 *     packages/graph/src/neo4j/schema.ts:14-17)
 *
 * Schema is idempotent via `IF NOT EXISTS` so `ensureSchema()` can run
 * repeatedly without failure.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reports (
  report_id       TEXT PRIMARY KEY,
  title           TEXT,
  source_filename TEXT,
  date            TEXT,
  num_pages       INTEGER
);

CREATE TABLE IF NOT EXISTS sections (
  section_id TEXT PRIMARY KEY,
  title      TEXT,
  level      INTEGER,
  "order"    INTEGER
);

CREATE TABLE IF NOT EXISTS paragraphs (
  paragraph_id TEXT PRIMARY KEY,
  text         TEXT,
  page         INTEGER
);

CREATE TABLE IF NOT EXISTS source_spans (
  span_id    TEXT PRIMARY KEY,
  text       TEXT,
  page       INTEGER,
  start_char INTEGER,
  end_char   INTEGER,
  block_id   TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  entity_id      TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  name           TEXT,
  description    TEXT,
  aliases        TEXT,   -- JSON array
  UNIQUE (canonical_name, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_entities_canon
  ON entities (canonical_name, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name
  ON entities (name);

CREATE TABLE IF NOT EXISTS metrics (
  metric_id TEXT PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,
  unit      TEXT
);

CREATE TABLE IF NOT EXISTS metric_values (
  value_id TEXT PRIMARY KEY,
  value    REAL,
  unit     TEXT,
  period   TEXT,
  context  TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id   TEXT PRIMARY KEY,
  text       TEXT,
  claim_type TEXT,
  confidence REAL,
  polarity   TEXT
);

CREATE TABLE IF NOT EXISTS time_periods (
  period_id  TEXT PRIMARY KEY,
  label      TEXT,
  start_date TEXT,
  end_date   TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  edge_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  properties TEXT,   -- JSON object
  UNIQUE (source_id, target_id, type)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);

-- node_index: single place to resolve an arbitrary id → its label.
-- Populated by triggers so ad-hoc queries like getSubgraph() don't have to
-- probe every typed table.
CREATE TABLE IF NOT EXISTS node_index (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- Triggers to keep node_index in sync with the typed tables.
${nodeIndexTriggers([
  ["reports", "report_id", "Report"],
  ["sections", "section_id", "Section"],
  ["paragraphs", "paragraph_id", "Paragraph"],
  ["source_spans", "span_id", "SourceSpan"],
  ["entities", "entity_id", "Entity"],
  ["metrics", "metric_id", "Metric"],
  ["metric_values", "value_id", "MetricValue"],
  ["claims", "claim_id", "Claim"],
  ["time_periods", "period_id", "TimePeriod"],
])}

-- FTS5 mirrors. content=... keeps FTS in sync via triggers we manage explicitly
-- below, avoiding the FTS5 'external content' indirection so reads are simple.
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  entity_id UNINDEXED,
  name,
  canonical_name,
  description
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts (entity_id, name, canonical_name, description)
  VALUES (new.entity_id, new.name, new.canonical_name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE entity_id = old.entity_id;
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  DELETE FROM entities_fts WHERE entity_id = old.entity_id;
  INSERT INTO entities_fts (entity_id, name, canonical_name, description)
  VALUES (new.entity_id, new.name, new.canonical_name, new.description);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
  claim_id UNINDEXED,
  text
);

CREATE TRIGGER IF NOT EXISTS claims_ai AFTER INSERT ON claims BEGIN
  INSERT INTO claims_fts (claim_id, text) VALUES (new.claim_id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS claims_ad AFTER DELETE ON claims BEGIN
  DELETE FROM claims_fts WHERE claim_id = old.claim_id;
END;

CREATE TRIGGER IF NOT EXISTS claims_au AFTER UPDATE ON claims BEGIN
  DELETE FROM claims_fts WHERE claim_id = old.claim_id;
  INSERT INTO claims_fts (claim_id, text) VALUES (new.claim_id, new.text);
END;

-- Optional conflict log (populated only when MergePolicy.conflictLog = true).
CREATE TABLE IF NOT EXISTS conflicts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id  TEXT,
  field      TEXT,
  old_value  TEXT,
  new_value  TEXT,
  at         TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

function nodeIndexTriggers(
  rows: Array<[table: string, idCol: string, label: string]>,
): string {
  return rows
    .map(
      ([table, idCol, label]) => `
CREATE TRIGGER IF NOT EXISTS ${table}_ni_ai AFTER INSERT ON ${table} BEGIN
  INSERT OR REPLACE INTO node_index (id, label) VALUES (new.${idCol}, '${label}');
END;
CREATE TRIGGER IF NOT EXISTS ${table}_ni_ad AFTER DELETE ON ${table} BEGIN
  DELETE FROM node_index WHERE id = old.${idCol};
END;`,
    )
    .join("\n");
}

/** Apply the DDL once per connection. Idempotent. */
export function ensureSchema(conn: SqliteConnection): void {
  conn.raw().exec(SCHEMA_SQL);
}
