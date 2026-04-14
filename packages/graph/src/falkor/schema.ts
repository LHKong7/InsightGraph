import { loadOntology } from "@insightgraph/core";
import type { Ontology } from "@insightgraph/core";
import { ConstraintType, EntityType } from "falkordb";
import type { FalkorConnection } from "./connection";

/**
 * Apply the ontology to a FalkorDB instance: unique constraints via Cypher
 * uniqueness indexes + fulltext indexes where the ontology requests them.
 *
 * FalkorDB's API is a bit different from Neo4j's:
 *   - Uniqueness is enforced via `createTypedIndex('UNIQUE', 'NODE', ...)` or
 *     via CREATE CONSTRAINT (newer releases). We use createNodeRangeIndex +
 *     CONSTRAINT CREATE UNIQUE to stay compatible across versions.
 *   - Fulltext uses `createNodeFulltextIndex(label, ...properties)` which
 *     internally issues `CALL db.idx.fulltext.createNodeIndex(...)`.
 *
 * All statements are wrapped in try/catch so re-running on an existing DB is
 * idempotent — creating a pre-existing index is a hard error in FalkorDB.
 */
export async function ensureSchema(
  conn: FalkorConnection,
  ontology?: Ontology,
): Promise<void> {
  await conn.open();
  const graph = conn.graph();
  const ont = ontology ?? loadOntology();

  for (const nodeDef of Object.values(ont.nodes)) {
    for (const constraint of nodeDef.constraints) {
      if (constraint.unique.length === 0) continue;
      // Range index is a prerequisite for the unique constraint.
      try {
        await graph.createNodeRangeIndex(nodeDef.name, ...constraint.unique);
      } catch {
        // index may already exist
      }
      try {
        await graph.constraintCreate(
          ConstraintType.UNIQUE,
          EntityType.NODE,
          nodeDef.name,
          ...constraint.unique,
        );
      } catch {
        // constraint may already exist or the constraint type is unsupported
      }
    }

    for (const index of nodeDef.indexes) {
      if (index.fulltext.length === 0) continue;
      try {
        await graph.createNodeFulltextIndex(nodeDef.name, ...index.fulltext);
      } catch {
        // already exists
      }
    }
  }
}
