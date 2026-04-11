from __future__ import annotations

import logging

from insightgraph_core.ontology.loader import load_ontology
from insightgraph_core.ontology.schema import Ontology, VectorIndexDef
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


def _vector_index_cypher(label: str, index_def: VectorIndexDef) -> str:
    """Build a CREATE VECTOR INDEX IF NOT EXISTS statement."""
    index_name = f"{label.lower()}_{index_def.property}_vector"
    return (
        f"CREATE VECTOR INDEX {index_name} IF NOT EXISTS "
        f"FOR (n:{label}) ON (n.{index_def.property}) "
        f"OPTIONS {{indexConfig: {{"
        f"`vector.dimensions`: {index_def.dimensions}, "
        f"`vector.similarity_function`: '{index_def.similarity}'"
        f"}}}}"
    )


async def ensure_schema(conn: Neo4jConnection, ontology: Ontology | None = None) -> None:
    """Create all Neo4j constraints, fulltext indexes, and vector indexes.

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

        for vidx in node_def.vector_indexes:
            statements.append(_vector_index_cypher(node_def.name, vidx))

    async with conn.session() as session:
        for stmt in statements:
            logger.debug("Executing schema DDL: %s", stmt)
            try:
                await session.run(stmt)
            except Exception:
                logger.warning("DDL statement failed (may require Neo4j Enterprise): %s", stmt)

    logger.info("Schema ensured: %d DDL statements executed", len(statements))
