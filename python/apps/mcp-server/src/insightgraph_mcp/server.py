from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from insightgraph_agent.orchestrator import Orchestrator
from insightgraph_core.config import get_settings
from insightgraph_graph.connection import Neo4jConnection
from insightgraph_graph.reader import GraphReader
from insightgraph_retriever.embeddings import EmbeddingService
from insightgraph_retriever.graph_retriever import GraphRetriever
from insightgraph_retriever.tools import AgentTools
from insightgraph_retriever.vector_retriever import VectorRetriever

logger = logging.getLogger(__name__)

server = Server("insightgraph")

# ---------------------------------------------------------------------------
# Lazy-initialised singletons
# ---------------------------------------------------------------------------

_conn: Neo4jConnection | None = None
_reader: GraphReader | None = None
_graph_retriever: GraphRetriever | None = None
_vector_retriever: VectorRetriever | None = None
_embedding_service: EmbeddingService | None = None


async def _get_connection() -> Neo4jConnection:
    global _conn
    if _conn is None:
        settings = get_settings()
        _conn = Neo4jConnection(
            uri=settings.neo4j_uri,
            user=settings.neo4j_user,
            password=settings.neo4j_password,
        )
    return _conn


async def _get_reader() -> GraphReader:
    global _reader
    if _reader is None:
        conn = await _get_connection()
        _reader = GraphReader(conn)
    return _reader


async def _get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is None:
        settings = get_settings()
        _embedding_service = EmbeddingService(
            model=settings.embedding_model,
            api_key=settings.llm_api_key,
        )
    return _embedding_service


async def _get_graph_retriever() -> GraphRetriever:
    global _graph_retriever
    if _graph_retriever is None:
        reader = await _get_reader()
        _graph_retriever = GraphRetriever(reader)
    return _graph_retriever


async def _get_vector_retriever() -> VectorRetriever:
    global _vector_retriever
    if _vector_retriever is None:
        conn = await _get_connection()
        embedding_service = await _get_embedding_service()
        _vector_retriever = VectorRetriever(conn, embedding_service)
    return _vector_retriever


# ---------------------------------------------------------------------------
# Tool catalogue
# ---------------------------------------------------------------------------

TOOLS: list[types.Tool] = [
    # ------------------------------------------------------------------
    # Query tools (read-only, fast)
    # ------------------------------------------------------------------
    types.Tool(
        name="search_documents",
        description=(
            "Search documents using semantic, graph, or hybrid search. "
            "Returns ranked results with text, score, page, section, and report_id."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return",
                    "default": 10,
                },
                "mode": {
                    "type": "string",
                    "enum": ["hybrid", "vector", "graph"],
                    "description": "Search mode: hybrid (vector + graph), vector-only, or graph-only",
                    "default": "hybrid",
                },
            },
            "required": ["query"],
        },
    ),
    types.Tool(
        name="find_entities",
        description=(
            "Look up entities by name and optional type filter. "
            "Returns matching entities with IDs, names, types, and descriptions."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Entity name or partial name to search for",
                },
                "type": {
                    "type": "string",
                    "description": "Filter by entity type (e.g. 'Company', 'Person', 'Metric')",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results",
                    "default": 10,
                },
            },
            "required": ["name"],
        },
    ),
    types.Tool(
        name="get_entity_details",
        description=(
            "Get a full profile for an entity: associated claims, metrics, and supporting evidence."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "entity_name": {
                    "type": "string",
                    "description": "Name of the entity to look up",
                },
            },
            "required": ["entity_name"],
        },
    ),
    types.Tool(
        name="get_claims_about",
        description=(
            "Retrieve claims/assertions that mention a specific entity, "
            "optionally filtered by claim type."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "entity_name": {
                    "type": "string",
                    "description": "Name of the entity",
                },
                "claim_type": {
                    "type": "string",
                    "description": "Filter by claim type (e.g. 'financial', 'operational')",
                },
            },
            "required": ["entity_name"],
        },
    ),
    types.Tool(
        name="get_metric_history",
        description=(
            "Retrieve historical values for a named metric, optionally "
            "scoped to a specific entity. Returns time-ordered values with "
            "periods and units."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "metric_name": {
                    "type": "string",
                    "description": "Name of the metric (e.g. 'Revenue', 'Headcount')",
                },
                "entity_name": {
                    "type": "string",
                    "description": "Scope results to this entity",
                },
            },
            "required": ["metric_name"],
        },
    ),
    types.Tool(
        name="find_evidence",
        description=(
            "Trace a claim back to its source text and page location. "
            "Returns source spans with page numbers and character offsets."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "claim_id": {
                    "type": "string",
                    "description": "ID of the claim to find evidence for",
                },
            },
            "required": ["claim_id"],
        },
    ),
    types.Tool(
        name="list_reports",
        description="List all available reports in the knowledge graph.",
        inputSchema={
            "type": "object",
            "properties": {},
        },
    ),
    # ------------------------------------------------------------------
    # Analysis tools (may invoke LLM)
    # ------------------------------------------------------------------
    types.Tool(
        name="analyze_question",
        description=(
            "Run a question through the full InsightGraph agent pipeline "
            "(planner -> retriever -> analyst -> verifier). Returns an "
            "evidence-backed answer with citations and confidence score. "
            "This tool is slower as it may invoke an LLM."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to analyze",
                },
            },
            "required": ["question"],
        },
    ),
]


# ---------------------------------------------------------------------------
# MCP handlers
# ---------------------------------------------------------------------------


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return TOOLS


def _text_result(data: Any) -> list[types.TextContent]:
    """Serialize *data* to a JSON text content block."""
    return [
        types.TextContent(
            type="text",
            text=json.dumps(data, indent=2, default=str),
        )
    ]


def _error_result(message: str) -> list[types.TextContent]:
    """Return a user-visible error as a text content block."""
    return [
        types.TextContent(
            type="text",
            text=json.dumps({"error": message}, indent=2),
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    try:
        if name == "search_documents":
            return await _handle_search_documents(arguments)
        elif name == "find_entities":
            return await _handle_find_entities(arguments)
        elif name == "get_entity_details":
            return await _handle_get_entity_details(arguments)
        elif name == "get_claims_about":
            return await _handle_get_claims_about(arguments)
        elif name == "get_metric_history":
            return await _handle_get_metric_history(arguments)
        elif name == "find_evidence":
            return await _handle_find_evidence(arguments)
        elif name == "list_reports":
            return await _handle_list_reports(arguments)
        elif name == "analyze_question":
            return await _handle_analyze_question(arguments)
        else:
            return _error_result(f"Unknown tool: {name}")
    except Exception:
        logger.exception("Error executing tool %s", name)
        return _error_result(f"Internal error while executing tool '{name}'")


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


async def _handle_search_documents(arguments: dict) -> list[types.TextContent]:
    query: str = arguments["query"]
    top_k: int = arguments.get("top_k", 10)
    mode: str = arguments.get("mode", "hybrid")

    if mode == "vector":
        vr = await _get_vector_retriever()
        results = await vr.search_all(query, top_k=top_k)
    elif mode == "graph":
        gr = await _get_graph_retriever()
        # Graph mode: find entities matching the query and return related claims
        entities = await gr.find_entities(name=query, limit=top_k)
        claims: list[dict] = []
        for entity in entities[:5]:
            entity_name = entity.get("entity", {}).get("canonical_name") or entity.get(
                "entity", {}
            ).get("name")
            if entity_name:
                entity_claims = await gr.get_claims_about(entity_name)
                claims.extend(entity_claims)
        results = {"entities": entities, "claims": claims[:top_k]}
    else:
        # hybrid: combine vector and graph results
        vr = await _get_vector_retriever()
        gr = await _get_graph_retriever()

        vector_results = await vr.search_all(query, top_k=top_k)
        entities = await gr.find_entities(name=query, limit=5)

        results = {
            "vector_results": vector_results[:top_k],
            "graph_entities": entities,
        }

    return _text_result(results)


async def _handle_find_entities(arguments: dict) -> list[types.TextContent]:
    reader = await _get_reader()
    results = await reader.find_entities(
        name=arguments.get("name"),
        entity_type=arguments.get("type"),
        limit=arguments.get("limit", 10),
    )
    return _text_result(results)


async def _handle_get_entity_details(arguments: dict) -> list[types.TextContent]:
    entity_name: str = arguments["entity_name"]
    reader = await _get_reader()
    gr = await _get_graph_retriever()
    conn = await _get_connection()

    # Gather entity matches and claims in parallel
    entities_task = reader.find_entities(name=entity_name, limit=5)
    claims_task = gr.get_claims_about(entity_name)

    entities, claims = await asyncio.gather(
        entities_task,
        claims_task,
        return_exceptions=True,
    )

    # Query all metrics associated with this entity (no metric_name filter)
    metrics: list[dict[str, Any]] = []
    try:
        metric_query = (
            "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) "
            "WHERE e.canonical_name = $entity_name OR e.name = $entity_name "
            "RETURN properties(mv) AS metric_value, "
            "       properties(m) AS metric, "
            "       properties(e) AS entity "
            "ORDER BY m.name, mv.period"
        )
        async with conn.session() as session:
            result = await session.run(metric_query, {"entity_name": entity_name})
            metrics = await result.data()
    except Exception:
        logger.debug("Failed to get metrics for entity %s", entity_name)

    # Build evidence list from claims
    evidence: list[dict] = []
    if isinstance(claims, list):
        for claim in claims[:10]:
            claim_id = claim.get("claim", {}).get("claim_id")
            if claim_id:
                try:
                    spans = await reader.find_evidence_for_claim(claim_id)
                    evidence.extend(spans)
                except Exception:
                    logger.debug("Failed to get evidence for claim %s", claim_id)

    profile: dict[str, Any] = {
        "entity_name": entity_name,
        "matching_entities": entities if isinstance(entities, list) else [],
        "claims": claims if isinstance(claims, list) else [],
        "metrics": metrics,
        "evidence": evidence,
    }
    return _text_result(profile)


async def _handle_get_claims_about(arguments: dict) -> list[types.TextContent]:
    entity_name: str = arguments["entity_name"]
    claim_type: str | None = arguments.get("claim_type")

    gr = await _get_graph_retriever()
    results = await gr.get_claims_about(entity_name, claim_type=claim_type)
    return _text_result(results)


async def _handle_get_metric_history(arguments: dict) -> list[types.TextContent]:
    metric_name: str = arguments["metric_name"]
    entity_name: str | None = arguments.get("entity_name")

    gr = await _get_graph_retriever()
    results = await gr.get_metric_history(metric_name, entity_name=entity_name)
    return _text_result(results)


async def _handle_find_evidence(arguments: dict) -> list[types.TextContent]:
    claim_id: str = arguments["claim_id"]

    reader = await _get_reader()
    results = await reader.find_evidence_for_claim(claim_id)
    return _text_result(results)


async def _handle_list_reports(arguments: dict) -> list[types.TextContent]:
    reader = await _get_reader()
    results = await reader.list_reports()
    return _text_result(results)


async def _handle_analyze_question(arguments: dict) -> list[types.TextContent]:
    question: str = arguments["question"]
    settings = get_settings()

    conn = await _get_connection()
    reader = GraphReader(conn)
    gr = GraphRetriever(reader)
    embedding_service = await _get_embedding_service()
    vr = VectorRetriever(conn, embedding_service)
    agent_tools = AgentTools(graph_retriever=gr, vector_retriever=vr)

    orchestrator = Orchestrator(
        tools=agent_tools,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
    )

    response = await orchestrator.query(question)
    return _text_result(response.model_dump())


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    asyncio.run(main())
