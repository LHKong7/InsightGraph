from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# --- Tool input/output schemas ---


class FindEntitiesInput(BaseModel):
    name: str | None = None
    entity_type: str | None = None
    report_id: str | None = None
    limit: int = 50


class EntityResult(BaseModel):
    entity_id: str
    name: str
    canonical_name: str | None = None
    entity_type: str
    description: str | None = None


class ClaimResult(BaseModel):
    claim_id: str
    text: str
    claim_type: str | None = None
    confidence: float | None = None
    entity_name: str | None = None


class MetricValueResult(BaseModel):
    value: float
    unit: str | None = None
    period: str | None = None
    metric_name: str
    entity_name: str | None = None


class EvidenceResult(BaseModel):
    span_id: str
    text: str
    page: int | None = None
    start_char: int | None = None
    end_char: int | None = None


class SubgraphResult(BaseModel):
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)


# --- Tool definitions ---


class ToolDefinition(BaseModel):
    """Describes a tool for the agent runtime."""

    name: str
    description: str
    parameters_schema: dict


# --- Tool implementations ---


class AgentTools:
    """Agent-callable tool functions backed by graph + vector retrieval."""

    def __init__(self, graph_retriever: Any, vector_retriever: Any | None = None):
        self._graph = graph_retriever
        self._vector = vector_retriever

    def get_tool_definitions(self) -> list[ToolDefinition]:
        """Return tool definitions for the agent runtime."""
        return [
            ToolDefinition(
                name="find_entities",
                description="Find entities matching a name query and optional type filter. Returns a list of entities with their IDs, names, types, and descriptions.",
                parameters_schema=FindEntitiesInput.model_json_schema(),
            ),
            ToolDefinition(
                name="get_claims_about",
                description="Get all claims/assertions that mention a specific entity. Returns claims with their text, type, and confidence.",
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "entity_name": {"type": "string", "description": "Name of the entity"},
                        "claim_type": {
                            "type": "string",
                            "description": "Filter by claim type",
                            "default": None,
                        },
                    },
                    "required": ["entity_name"],
                },
            ),
            ToolDefinition(
                name="get_metric_history",
                description="Get historical values for a metric, optionally filtered by entity. Returns time-ordered metric values with periods and units.",
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "metric_name": {"type": "string", "description": "Name of the metric"},
                        "entity_name": {
                            "type": "string",
                            "description": "Filter by entity name",
                            "default": None,
                        },
                    },
                    "required": ["metric_name"],
                },
            ),
            ToolDefinition(
                name="find_evidence_for_claim",
                description="Find the source text spans that support a specific claim. Returns the original text with page numbers and character offsets.",
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "claim_id": {"type": "string", "description": "ID of the claim"},
                    },
                    "required": ["claim_id"],
                },
            ),
            ToolDefinition(
                name="get_subgraph_for_question",
                description="Retrieve a relevant subgraph for answering an open-ended question. Finds matching entities and expands their neighborhood.",
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "The question to find relevant context for",
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Max hops from matched entities",
                            "default": 2,
                        },
                        "max_nodes": {
                            "type": "integer",
                            "description": "Max nodes to return",
                            "default": 50,
                        },
                    },
                    "required": ["question"],
                },
            ),
        ]

    async def execute(self, tool_name: str, arguments: dict) -> Any:
        """Execute a tool by name with the given arguments."""
        handlers = {
            "find_entities": self._find_entities,
            "get_claims_about": self._get_claims_about,
            "get_metric_history": self._get_metric_history,
            "find_evidence_for_claim": self._find_evidence_for_claim,
            "get_subgraph_for_question": self._get_subgraph_for_question,
        }
        handler = handlers.get(tool_name)
        if not handler:
            raise ValueError(f"Unknown tool: {tool_name}")
        return await handler(**arguments)

    async def _find_entities(self, **kwargs: Any) -> list[dict]:
        return await self._graph.find_entities(**kwargs)

    async def _get_claims_about(
        self, entity_name: str, claim_type: str | None = None
    ) -> list[dict]:
        return await self._graph.get_claims_about(entity_name, claim_type)

    async def _get_metric_history(
        self, metric_name: str, entity_name: str | None = None
    ) -> list[dict]:
        return await self._graph.get_metric_history(metric_name, entity_name)

    async def _find_evidence_for_claim(self, claim_id: str) -> list[dict]:
        return await self._graph.find_evidence_for_claim(claim_id)

    async def _get_subgraph_for_question(
        self,
        question: str,
        max_depth: int = 2,
        max_nodes: int = 50,
    ) -> dict:
        """Retrieve relevant subgraph for a question.

        Strategy:
        1. Extract key terms from the question
        2. Find matching entities via fulltext search
        3. Expand neighborhood by max_depth hops
        """
        # Extract keywords by finding entities matching the question
        entities = await self._graph.find_entities(name=question, limit=5)

        if not entities:
            # Try vector search as fallback
            if self._vector:
                return {
                    "nodes": await self._vector.search_paragraphs(question, max_nodes),
                    "edges": [],
                }
            return {"nodes": [], "edges": []}

        # Get subgraph around the top entity
        top_entity_id = entities[0].get("entity_id")
        if top_entity_id:
            return await self._graph.get_subgraph(top_entity_id, max_depth)

        return {"nodes": entities, "edges": []}
