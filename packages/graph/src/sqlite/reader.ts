import type { Database } from "better-sqlite3";
import type { GraphReader as IGraphReader } from "../types";
import type { SqliteConnection } from "./connection";

/**
 * SQLite GraphReader — mirrors each method in packages/graph/src/neo4j/reader.ts.
 * Output shapes match the Neo4j reader so callers (API/SDK/retriever) don't need
 * to branch on backend. `aliases` is stored as JSON text in the entities table
 * and parsed back to a string[] before being returned.
 */
export class SqliteGraphReader implements IGraphReader {
  private db: Database;

  constructor(conn: SqliteConnection) {
    this.db = conn.raw();
  }

  // --- Entity queries --------------------------------------------------------

  async findEntities(
    name?: string,
    entityType?: string,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    // Clamp to a sane range — 1..1000 — so an unvalidated caller can't issue
    // a `LIMIT -1` or `LIMIT 10000000` query that OOMs the process.
    const cap = Math.min(Math.max(1, Math.trunc(limit) || 1), 1000);
    if (name) {
      const where = entityType ? " AND e.entity_type = ?" : "";
      const query = `
        SELECT e.*, bm25(entities_fts) AS score
          FROM entities_fts
          JOIN entities e ON e.entity_id = entities_fts.entity_id
         WHERE entities_fts MATCH ?${where}
         ORDER BY score ASC
         LIMIT ?`;
      const params: unknown[] = [ftsQuery(name)];
      if (entityType) params.push(entityType);
      params.push(cap);
      const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
      return rows.map((r) => ({ entity: hydrateEntity(r), score: r.score }));
    }

    let query = `SELECT * FROM entities`;
    const params: unknown[] = [];
    if (entityType) {
      query += ` WHERE entity_type = ?`;
      params.push(entityType);
    }
    query += ` LIMIT ?`;
    params.push(cap);
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({ entity: hydrateEntity(r) }));
  }

  async getEntity(entityId: string): Promise<Record<string, unknown> | null> {
    const row = this.db
      .prepare(`SELECT * FROM entities WHERE entity_id = ?`)
      .get(entityId) as Record<string, unknown> | undefined;
    return row ? hydrateEntity(row) : null;
  }

  // --- Claim queries ---------------------------------------------------------

  async getClaimsAbout(entityName: string): Promise<Record<string, unknown>[]> {
    const rows = this.db
      .prepare(
        `SELECT c.*, e.entity_id AS e_entity_id, e.canonical_name AS e_canonical_name,
                e.entity_type AS e_entity_type, e.name AS e_name,
                e.description AS e_description, e.aliases AS e_aliases
           FROM entities e
           JOIN edges ed ON ed.target_id = e.entity_id
                        AND ed.type IN ('MENTIONS','ABOUT')
           JOIN claims c ON c.claim_id = ed.source_id
          WHERE e.canonical_name = ? OR e.name = ?`,
      )
      .all(entityName, entityName) as Record<string, unknown>[];
    return rows.map((r) => ({
      claim: extractPrefix(r, ""),
      entity: hydrateEntity(unprefix(r, "e_")),
    }));
  }

  async findEvidenceForClaim(
    claimId: string,
  ): Promise<Record<string, unknown>[]> {
    const rows = this.db
      .prepare(
        `SELECT s.*
           FROM edges ed
           JOIN source_spans s ON s.span_id = ed.target_id
          WHERE ed.source_id = ? AND ed.type = 'SUPPORTED_BY'`,
      )
      .all(claimId) as Record<string, unknown>[];
    return rows.map((r) => ({ span: r }));
  }

  // --- Metric queries --------------------------------------------------------

  async getEntityMetrics(entityName: string): Promise<Record<string, unknown>[]> {
    const rows = this.db
      .prepare(
        `SELECT mv.value_id, mv.value, mv.unit AS mv_unit, mv.period,
                m.metric_id, m.name AS metric_name, m.unit AS metric_unit,
                e.entity_id, e.canonical_name, e.entity_type, e.name AS entity_name,
                e.description AS entity_description, e.aliases AS entity_aliases
           FROM entities e
           JOIN edges hv ON hv.source_id = e.entity_id AND hv.type = 'HAS_VALUE'
           JOIN metric_values mv ON mv.value_id = hv.target_id
           JOIN edges ms ON ms.source_id = mv.value_id AND ms.type = 'MEASURES'
           JOIN metrics m ON m.metric_id = ms.target_id
          WHERE e.canonical_name = ? OR e.name = ?
          ORDER BY m.name, mv.period`,
      )
      .all(entityName, entityName) as Record<string, unknown>[];
    return rows.map(metricRowToResult);
  }

  async getMetricHistory(
    metricName: string,
    entityName?: string,
  ): Promise<Record<string, unknown>[]> {
    if (entityName) {
      const rows = this.db
        .prepare(
          `SELECT mv.value_id, mv.value, mv.unit AS mv_unit, mv.period,
                  m.metric_id, m.name AS metric_name, m.unit AS metric_unit,
                  e.entity_id, e.canonical_name, e.entity_type, e.name AS entity_name,
                  e.description AS entity_description, e.aliases AS entity_aliases
             FROM metrics m
             JOIN edges ms ON ms.target_id = m.metric_id AND ms.type = 'MEASURES'
             JOIN metric_values mv ON mv.value_id = ms.source_id
             JOIN edges hv ON hv.target_id = mv.value_id AND hv.type = 'HAS_VALUE'
             JOIN entities e ON e.entity_id = hv.source_id
            WHERE m.name = ?
              AND (e.canonical_name = ? OR e.name = ?)
            ORDER BY mv.period`,
        )
        .all(metricName, entityName, entityName) as Record<string, unknown>[];
      return rows.map(metricRowToResult);
    }
    const rows = this.db
      .prepare(
        `SELECT mv.value_id, mv.value, mv.unit AS mv_unit, mv.period,
                m.metric_id, m.name AS metric_name, m.unit AS metric_unit
           FROM metrics m
           JOIN edges ms ON ms.target_id = m.metric_id AND ms.type = 'MEASURES'
           JOIN metric_values mv ON mv.value_id = ms.source_id
          WHERE m.name = ?
          ORDER BY mv.period`,
      )
      .all(metricName) as Record<string, unknown>[];
    return rows.map((r) => ({
      metric_value: {
        value_id: r.value_id,
        value: r.value,
        unit: r.mv_unit,
        period: r.period,
      },
      metric: { metric_id: r.metric_id, name: r.metric_name, unit: r.metric_unit },
    }));
  }

  // --- Subgraph --------------------------------------------------------------

  async getSubgraph(
    nodeId: string,
    depth = 2,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    const d = Math.max(1, Math.min(depth, 5));
    // Confirm the start node exists.
    const startExists = this.db
      .prepare(`SELECT id, label FROM node_index WHERE id = ?`)
      .get(nodeId) as { id: string; label: string } | undefined;
    if (!startExists) return { nodes: [], edges: [] };

    // Recursive CTE walking undirected edges up to depth d.
    const rows = this.db
      .prepare(
        `WITH RECURSIVE walk(id, depth) AS (
           SELECT ?, 0
           UNION
           SELECT CASE WHEN e.source_id = w.id THEN e.target_id
                       ELSE e.source_id END,
                  w.depth + 1
             FROM walk w
             JOIN edges e
               ON (e.source_id = w.id OR e.target_id = w.id)
            WHERE w.depth < ?
         )
         SELECT DISTINCT id FROM walk`,
      )
      .all(nodeId, d) as { id: string }[];

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { nodes: [], edges: [] };

    const nodes: unknown[] = [];
    for (const id of ids) {
      const node = this.lookupNode(id);
      if (node) nodes.push(node);
    }

    // Select edges where both endpoints are in the visited set.
    const placeholders = ids.map(() => "?").join(",");
    const edges = this.db
      .prepare(
        `SELECT edge_id AS id, source_id AS startId, target_id AS endId,
                type, properties
           FROM edges
          WHERE source_id IN (${placeholders})
            AND target_id IN (${placeholders})`,
      )
      .all(...ids, ...ids) as Record<string, unknown>[];

    return {
      nodes,
      edges: edges.map((e) => ({
        id: String(e.id),
        type: e.type,
        startId: e.startId,
        endId: e.endId,
        props: e.properties ? JSON.parse(e.properties as string) : {},
      })),
    };
  }

  // --- Report queries --------------------------------------------------------

  async getReport(reportId: string): Promise<Record<string, unknown> | null> {
    const row = this.db
      .prepare(`SELECT * FROM reports WHERE report_id = ?`)
      .get(reportId) as Record<string, unknown> | undefined;
    return row ?? null;
  }

  async listReports(): Promise<Record<string, unknown>[]> {
    const rows = this.db
      .prepare(`SELECT * FROM reports ORDER BY date DESC`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({ report: r }));
  }

  // --- Relationship queries --------------------------------------------------

  async getEntityRelationships(
    entityName: string,
  ): Promise<Record<string, unknown>[]> {
    // Resolve the anchor entity id(s) by either canonical_name or name.
    const anchors = this.db
      .prepare(
        `SELECT entity_id FROM entities WHERE canonical_name = ? OR name = ?`,
      )
      .all(entityName, entityName) as { entity_id: string }[];
    if (anchors.length === 0) return [];
    const ids = anchors.map((a) => a.entity_id);
    const ph = ids.map(() => "?").join(",");

    const out: Record<string, unknown>[] = [];
    const outgoing = this.db
      .prepare(
        `SELECT ed.type AS relationship_type, ed.properties AS rel_props,
                other.*
           FROM edges ed
           JOIN entities other ON other.entity_id = ed.target_id
          WHERE ed.source_id IN (${ph})
            AND other.entity_id NOT IN (${ph})`,
      )
      .all(...ids, ...ids) as Record<string, unknown>[];
    for (const r of outgoing) {
      out.push({
        relationship_type: r.relationship_type,
        relationship_props: r.rel_props ? JSON.parse(r.rel_props as string) : {},
        related_entity: hydrateEntity(stripRelProps(r)),
        direction: "outgoing",
      });
    }
    const incoming = this.db
      .prepare(
        `SELECT ed.type AS relationship_type, ed.properties AS rel_props,
                other.*
           FROM edges ed
           JOIN entities other ON other.entity_id = ed.source_id
          WHERE ed.target_id IN (${ph})
            AND other.entity_id NOT IN (${ph})`,
      )
      .all(...ids, ...ids) as Record<string, unknown>[];
    for (const r of incoming) {
      out.push({
        relationship_type: r.relationship_type,
        relationship_props: r.rel_props ? JSON.parse(r.rel_props as string) : {},
        related_entity: hydrateEntity(stripRelProps(r)),
        direction: "incoming",
      });
    }
    return out;
  }

  async findPath(
    entityA: string,
    entityB: string,
    maxDepth = 4,
  ): Promise<{ nodes: unknown[]; edges: unknown[]; found: boolean }> {
    const d = Math.max(1, Math.min(maxDepth, 10));
    const src = this.db
      .prepare(
        `SELECT entity_id FROM entities WHERE canonical_name = ? OR name = ? LIMIT 1`,
      )
      .get(entityA, entityA) as { entity_id: string } | undefined;
    const dst = this.db
      .prepare(
        `SELECT entity_id FROM entities WHERE canonical_name = ? OR name = ? LIMIT 1`,
      )
      .get(entityB, entityB) as { entity_id: string } | undefined;
    if (!src || !dst) return { nodes: [], edges: [], found: false };

    // Level-batched BFS. Previously we issued one `edges` SELECT per visited
    // node, which is quadratic-ish for deep paths and dense nodes. Instead,
    // each level collects the whole frontier and runs a single query with
    // `source_id IN (...) OR target_id IN (...)`, cutting DB round-trips
    // from O(|V|) to O(d).
    const visited = new Set<string>([src.entity_id]);
    const parent = new Map<string, { from: string; edge: unknown }>();
    let frontier: string[] = [src.entity_id];
    let found = visited.has(dst.entity_id);
    for (let depth = 0; depth < d && !found && frontier.length > 0; depth++) {
      const placeholders = frontier.map(() => "?").join(",");
      const edgeRows = this.db
        .prepare(
          `SELECT edge_id, source_id, target_id, type, properties
             FROM edges
            WHERE source_id IN (${placeholders})
               OR target_id IN (${placeholders})`,
        )
        .all(...frontier, ...frontier) as Record<string, unknown>[];

      const frontierSet = new Set(frontier);
      const nextFrontier: string[] = [];
      for (const e of edgeRows) {
        const sId = e.source_id as string;
        const tId = e.target_id as string;
        // An edge between two frontier nodes shows up with both endpoints
        // already visited — we have to pick the endpoint we came *from*.
        let fromId: string;
        let other: string;
        if (frontierSet.has(sId) && !visited.has(tId)) {
          fromId = sId;
          other = tId;
        } else if (frontierSet.has(tId) && !visited.has(sId)) {
          fromId = tId;
          other = sId;
        } else {
          continue;
        }
        visited.add(other);
        let edgeProps: unknown = {};
        if (e.properties) {
          try {
            edgeProps = JSON.parse(e.properties as string);
          } catch {
            edgeProps = {};
          }
        }
        parent.set(other, {
          from: fromId,
          edge: { type: e.type, props: edgeProps },
        });
        if (other === dst.entity_id) {
          found = true;
          break;
        }
        nextFrontier.push(other);
      }
      frontier = nextFrontier;
    }

    if (!found) return { nodes: [], edges: [], found: false };

    // Walk parent chain back to build the path.
    const pathIds: string[] = [];
    const pathEdges: unknown[] = [];
    let cur = dst.entity_id;
    pathIds.push(cur);
    while (cur !== src.entity_id) {
      const p = parent.get(cur)!;
      pathEdges.push(p.edge);
      cur = p.from;
      pathIds.push(cur);
    }
    pathIds.reverse();
    pathEdges.reverse();

    const nodes: unknown[] = [];
    for (const id of pathIds) {
      const n = this.lookupNode(id);
      if (n) nodes.push({ labels: [n.label], props: n.props });
    }
    return { nodes, edges: pathEdges, found: true };
  }

  async getEntityFullProfile(
    entityName: string,
  ): Promise<Record<string, unknown>> {
    const ent = this.db
      .prepare(
        `SELECT * FROM entities WHERE canonical_name = ? OR name = ? LIMIT 1`,
      )
      .get(entityName, entityName) as Record<string, unknown> | undefined;
    if (!ent) return {};
    const entityId = ent.entity_id as string;

    const claims = this.db
      .prepare(
        `SELECT DISTINCT c.claim_id, c.text, c.claim_type AS type, c.confidence
           FROM claims c
           JOIN edges e ON e.source_id = c.claim_id
                       AND e.type IN ('MENTIONS','ABOUT')
          WHERE e.target_id = ?`,
      )
      .all(entityId);
    const evidence = this.db
      .prepare(
        `SELECT DISTINCT s.text, s.page
           FROM claims c
           JOIN edges ce ON ce.source_id = c.claim_id
                        AND ce.type IN ('MENTIONS','ABOUT')
           JOIN edges se ON se.source_id = c.claim_id
                        AND se.type = 'SUPPORTED_BY'
           JOIN source_spans s ON s.span_id = se.target_id
          WHERE ce.target_id = ?`,
      )
      .all(entityId);
    const metrics = this.db
      .prepare(
        `SELECT DISTINCT mv.value, mv.unit, mv.period, m.name AS metric_name
           FROM edges hv
           JOIN metric_values mv ON mv.value_id = hv.target_id
           JOIN edges ms ON ms.source_id = mv.value_id AND ms.type = 'MEASURES'
           JOIN metrics m ON m.metric_id = ms.target_id
          WHERE hv.source_id = ? AND hv.type = 'HAS_VALUE'`,
      )
      .all(entityId);
    const related = this.db
      .prepare(
        `SELECT DISTINCT other.canonical_name AS name, other.entity_type AS type,
                ed.type AS relationship
           FROM edges ed
           JOIN entities other ON other.entity_id =
                CASE WHEN ed.source_id = ? THEN ed.target_id ELSE ed.source_id END
          WHERE (ed.source_id = ? OR ed.target_id = ?)
            AND other.entity_id != ?`,
      )
      .all(entityId, entityId, entityId, entityId);
    const reports = this.db
      .prepare(
        `SELECT DISTINCT r.report_id, r.title
           FROM edges sf
           JOIN reports r ON r.report_id = sf.target_id
          WHERE sf.source_id = ? AND sf.type = 'SOURCED_FROM'`,
      )
      .all(entityId);

    return {
      entity: hydrateEntity(ent),
      claims,
      evidence,
      metrics,
      related_entities: related,
      reports,
    };
  }

  async getCrossReportEntity(
    entityName: string,
  ): Promise<Record<string, unknown>> {
    const ent = this.db
      .prepare(
        `SELECT * FROM entities WHERE canonical_name = ? OR name = ? LIMIT 1`,
      )
      .get(entityName, entityName) as Record<string, unknown> | undefined;
    if (!ent) return { entity_name: entityName, reports: [] };
    const entityId = ent.entity_id as string;

    const reports = this.db
      .prepare(
        `SELECT r.*
           FROM edges sf
           JOIN reports r ON r.report_id = sf.target_id
          WHERE sf.source_id = ? AND sf.type = 'SOURCED_FROM'
          ORDER BY r.date`,
      )
      .all(entityId) as Record<string, unknown>[];

    const out: Record<string, unknown>[] = [];
    for (const report of reports) {
      // We don't have a direct report→claim edge; reuse profile aggregation.
      const claims = this.db
        .prepare(
          `SELECT DISTINCT c.text, c.claim_type AS type, s.page
             FROM claims c
             JOIN edges ce ON ce.source_id = c.claim_id
                          AND ce.type IN ('MENTIONS','ABOUT')
             LEFT JOIN edges se ON se.source_id = c.claim_id
                               AND se.type = 'SUPPORTED_BY'
             LEFT JOIN source_spans s ON s.span_id = se.target_id
            WHERE ce.target_id = ?`,
        )
        .all(entityId);
      const metrics = this.db
        .prepare(
          `SELECT DISTINCT mv.value, mv.unit, mv.period, m.name AS metric
             FROM edges hv
             JOIN metric_values mv ON mv.value_id = hv.target_id
             JOIN edges ms ON ms.source_id = mv.value_id AND ms.type = 'MEASURES'
             JOIN metrics m ON m.metric_id = ms.target_id
            WHERE hv.source_id = ? AND hv.type = 'HAS_VALUE'`,
        )
        .all(entityId);
      out.push({ entity: hydrateEntity(ent), report, claims, metrics });
    }
    return { entity_name: entityName, reports: out };
  }

  // --- Internal helpers ------------------------------------------------------

  /**
   * Resolve an arbitrary node id to `{ label, props }` using node_index +
   * the typed table. Used by getSubgraph/findPath.
   */
  private lookupNode(id: string): { label: string; props: Record<string, unknown> } | null {
    const idx = this.db
      .prepare(`SELECT label FROM node_index WHERE id = ?`)
      .get(id) as { label: string } | undefined;
    if (!idx) return null;
    const table = LABEL_TO_TABLE[idx.label];
    const keyCol = LABEL_TO_KEYCOL[idx.label];
    if (!table || !keyCol) return null;
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      label: idx.label,
      props: idx.label === "Entity" ? hydrateEntity(row) : row,
    };
  }
}

// -- Shared helpers -----------------------------------------------------------

const LABEL_TO_TABLE: Record<string, string> = {
  Report: "reports",
  Section: "sections",
  Paragraph: "paragraphs",
  SourceSpan: "source_spans",
  Entity: "entities",
  Metric: "metrics",
  MetricValue: "metric_values",
  Claim: "claims",
  TimePeriod: "time_periods",
};

const LABEL_TO_KEYCOL: Record<string, string> = {
  Report: "report_id",
  Section: "section_id",
  Paragraph: "paragraph_id",
  SourceSpan: "span_id",
  Entity: "entity_id",
  Metric: "metric_id",
  MetricValue: "value_id",
  Claim: "claim_id",
  TimePeriod: "period_id",
};

/** Convert JSON alias blob to a string[], keeping other fields intact. */
function hydrateEntity(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (typeof out.aliases === "string") {
    try {
      out.aliases = JSON.parse(out.aliases as string);
    } catch {
      out.aliases = [];
    }
  }
  if (out.aliases == null) out.aliases = [];
  return out;
}

/** Extract rows with a given column prefix (e.g. "e_col" → "col"). */
function unprefix(
  row: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

function extractPrefix(
  row: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (prefix === "" && !k.startsWith("e_")) out[k] = v;
    else if (prefix !== "" && k.startsWith(prefix))
      out[k.slice(prefix.length)] = v;
  }
  return out;
}

function stripRelProps(row: Record<string, unknown>): Record<string, unknown> {
  const { relationship_type, rel_props, ...rest } = row;
  void relationship_type;
  void rel_props;
  return rest;
}

function metricRowToResult(r: Record<string, unknown>): Record<string, unknown> {
  return {
    metric_value: {
      value_id: r.value_id,
      value: r.value,
      unit: r.mv_unit,
      period: r.period,
    },
    metric: {
      metric_id: r.metric_id,
      name: r.metric_name,
      unit: r.metric_unit,
    },
    entity: hydrateEntity({
      entity_id: r.entity_id,
      canonical_name: r.canonical_name,
      entity_type: r.entity_type,
      name: r.entity_name,
      description: r.entity_description,
      aliases: r.entity_aliases,
    }),
  };
}

/**
 * FTS5 prefix-matching query. We split the user input on whitespace and
 * append '*' to each token so partial matches work (`App` matches `Apple`).
 * Quoted phrases are preserved as-is.
 */
function ftsQuery(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '""';
  // If user passed a phrase in quotes, trust them.
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.replace(/["]/g, ""))
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`);
  return tokens.join(" ");
}
