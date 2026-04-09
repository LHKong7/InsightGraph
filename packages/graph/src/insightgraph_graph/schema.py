from __future__ import annotations

import logging

from insightgraph_core.ontology.loader import load_ontology
from insightgraph_core.ontology.schema import Ontology
from insightgraph_graph.connection import Neo4jConnection

logger = logging.getLogger(__name__)


def _constraint_cypher(label: str, properties: list[str]) -> str:
    """Build a CREATE CONSTRAINT IF NOT EXISTS statement."""
    prop_clause = ", ".join(f"n.{p}" for p in properties)
    constraint_name = f"{label.lower()}_{'_'.join(properties)}_unique"
    return (
        f"CREATE CONSTRAINT {constraint_name} IF NOT EXISTS "
        f"FOR (n:{label}) REQUIRE ({prop_clause}) IS UNIQUE"
    )


def _fulltext_index_cypher(label: str, properties: list[str]) -> str:
    """Build a CREATE FULLTEXT INDEX IF NOT EXISTS statement."""
    index_name = f"{label.lower()}_search"
    prop_list = ", ".join(f"n.{p}" for p in properties)
    return f"CREATE FULLTEXT INDEX {index_name} IF NOT EXISTS FOR (n:{label}) ON EACH [{prop_list}]"


async def ensure_schema(conn: Neo4jConnection, ontology: Ontology | None = None) -> None:
    """Create all Neo4j constraints and indexes defined in the ontology.

    If *ontology* is not provided it will be loaded from the bundled YAML files.
    """
    if ontology is None:
        ontology = load_ontology()

    statements: list[str] = []

    for node_def in ontology.nodes.values():
        for constraint in node_def.constraints:
            if constraint.unique:
                statements.append(_constraint_cypher(node_def.name, constraint.unique))

        for index in node_def.indexes:
            if index.fulltext:
                statements.append(_fulltext_index_cypher(node_def.name, index.fulltext))

    async with conn.session() as session:
        for stmt in statements:
            logger.debug("Executing schema DDL: %s", stmt)
            await session.run(stmt)

    logger.info("Schema ensured: %d DDL statements executed", len(statements))
