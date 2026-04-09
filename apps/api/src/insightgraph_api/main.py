from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from insightgraph_api.dependencies import get_cached_settings, get_ontology
from insightgraph_api.routes import agent, health, ingestion, query
from insightgraph_graph.connection import Neo4jConnection
from insightgraph_graph.schema import ensure_schema

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: initialize and teardown resources."""
    settings = get_cached_settings()
    ontology = get_ontology()

    # Initialize Neo4j connection
    conn = Neo4jConnection(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
    )
    try:
        await conn.verify_connectivity()
        logger.info("Connected to Neo4j at %s", settings.neo4j_uri)
    except Exception:
        logger.warning("Neo4j not available, some features will be limited")

    # Ensure graph schema
    try:
        await ensure_schema(conn, ontology)
        logger.info("Graph schema ensured")
    except Exception:
        logger.warning("Could not ensure graph schema", exc_info=True)

    app.state.neo4j = conn
    app.state.settings = settings
    app.state.ontology = ontology

    yield

    # Cleanup
    await conn.close()
    logger.info("Neo4j connection closed")


def create_app() -> FastAPI:
    app = FastAPI(
        title="InsightGraph",
        description="Turn reports into evidence-centric knowledge graphs for AI agent analysis",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.include_router(health.router)
    app.include_router(ingestion.router)
    app.include_router(query.router)
    app.include_router(agent.router)

    return app


app = create_app()
