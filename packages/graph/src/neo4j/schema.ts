import { loadOntology } from "@insightgraph/core";
import type { Ontology } from "@insightgraph/core";
import { Neo4jConnection } from "./connection";

function constraintCypher(label: string, properties: string[]): string {
  const propClause = properties.map((p) => `n.${p}`).join(", ");
  const constraintName = `${label.toLowerCase()}_${properties.join("_")}_unique`;
  return (
    `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS ` +
    `FOR (n:${label}) REQUIRE (${propClause}) IS UNIQUE`
  );
}

function fulltextIndexCypher(label: string, properties: string[]): string {
  const indexName = `${label.toLowerCase()}_search`;
  const propList = properties.map((p) => `n.${p}`).join(", ");
  return `CREATE FULLTEXT INDEX ${indexName} IF NOT EXISTS FOR (n:${label}) ON EACH [${propList}]`;
}

export async function ensureSchema(
  conn: Neo4jConnection,
  ontology?: Ontology,
): Promise<void> {
  const ont = ontology ?? loadOntology();
  const statements: string[] = [];

  for (const nodeDef of Object.values(ont.nodes)) {
    for (const constraint of nodeDef.constraints) {
      if (constraint.unique.length > 0) {
        statements.push(constraintCypher(nodeDef.name, constraint.unique));
      }
    }
    for (const index of nodeDef.indexes) {
      if (index.fulltext.length > 0) {
        statements.push(fulltextIndexCypher(nodeDef.name, index.fulltext));
      }
    }
  }

  const session = conn.session();
  try {
    for (const stmt of statements) {
      try {
        await session.run(stmt);
      } catch {
        // May fail on Community Edition (vector/fulltext indexes)
      }
    }
  } finally {
    await session.close();
  }
}
