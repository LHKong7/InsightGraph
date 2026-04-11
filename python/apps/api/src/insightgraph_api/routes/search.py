from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from insightgraph_graph.embedding_writer import EmbeddingWriter
from insightgraph_graph.reader import GraphReader
from insightgraph_retriever.embeddings import EmbeddingService
from insightgraph_retriever.graph_retriever import GraphRetriever
from insightgraph_retriever.hybrid_retriever import HybridRetriever, RetrievalResult
from insightgraph_retriever.vector_retriever import VectorRetriever

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["search"])


# ------------------------------------------------------------------
# Request / response models
# ------------------------------------------------------------------


class SearchMode(StrEnum):
    hybrid = "hybrid"
    vector = "vector"
    graph = "graph"


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=10, ge=1, le=100)
    mode: SearchMode = SearchMode.hybrid
    report_id: str | None = None


class SearchResponse(BaseModel):
    results: list[dict[str, Any]]
    total: int


class RetrieveRequest(BaseModel):
    question: str
    top_k: int = Field(default=10, ge=1, le=100)
    include_evidence: bool = True


class EmbedResponse(BaseModel):
    paragraphs_embedded: int
    claims_embedded: int


# ------------------------------------------------------------------
# Dependency helpers
# ------------------------------------------------------------------


def _get_embedding_service(request: Request) -> EmbeddingService:
    """Build an ``EmbeddingService`` from app settings."""
    settings = request.app.state.settings
    return EmbeddingService(
        model=settings.embedding_model,
        api_key=settings.llm_api_key,
    )


def _get_vector_retriever(request: Request) -> VectorRetriever:
    conn = request.app.state.neo4j
    embedding_service = _get_embedding_service(request)
    return VectorRetriever(conn=conn, embedding_service=embedding_service)


def _get_graph_retriever(request: Request) -> GraphRetriever:
    reader = GraphReader(request.app.state.neo4j)
    return GraphRetriever(reader=reader)


def _get_hybrid_retriever(request: Request) -> HybridRetriever:
    return HybridRetriever(
        graph_retriever=_get_graph_retriever(request),
        vector_retriever=_get_vector_retriever(request),
    )


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------


@router.post("/search", response_model=SearchResponse)
async def search(request: Request, body: SearchRequest) -> SearchResponse:
    """Unified search endpoint supporting hybrid, vector-only, and graph-only modes."""
    try:
        if body.mode == SearchMode.vector:
            retriever = _get_vector_retriever(request)
            results = await retriever.search_all(body.query, top_k=body.top_k)

        elif body.mode == SearchMode.graph:
            graph = _get_graph_retriever(request)
            entities = await graph.find_entities(
                name=body.query,
                report_id=body.report_id,
                limit=body.top_k,
            )
            # Flatten entity dicts and tag with source
            results: list[dict[str, Any]] = []
            for rec in entities:
                entity = rec.get("entity", rec)
                entity["source"] = "graph"
                entity["result_type"] = "entity"
                results.append(entity)

        else:
            # hybrid (default)
            hybrid = _get_hybrid_retriever(request)
            results = await hybrid.search(
                body.query,
                top_k=body.top_k,
                report_id=body.report_id,
            )

        return SearchResponse(results=results, total=len(results))

    except Exception as exc:
        logger.error("Search failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {exc}",
        ) from exc


@router.post("/retrieve", response_model=RetrievalResult)
async def retrieve(request: Request, body: RetrieveRequest) -> RetrievalResult:
    """Structured retrieval for RAG: returns paragraphs, claims, entities, metrics, and sources."""
    try:
        hybrid = _get_hybrid_retriever(request)
        result = await hybrid.retrieve_for_question(
            body.question,
            top_k=body.top_k,
        )

        # Strip evidence if not requested
        if not body.include_evidence:
            for claim in result.claims:
                claim.pop("evidence", None)

        return result

    except Exception as exc:
        logger.error("Retrieve failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Retrieve failed: {exc}",
        ) from exc


@router.post("/reports/{report_id}/embed", response_model=EmbedResponse)
async def embed_report(request: Request, report_id: str) -> EmbedResponse:
    """Trigger embedding generation for an existing report (backfill).

    Generates embeddings for all Paragraph and Claim nodes belonging
    to the given report that do not yet have an embedding vector.
    """
    conn = request.app.state.neo4j
    embedding_service = _get_embedding_service(request)

    # Verify report exists
    reader = GraphReader(conn)
    report = await reader.get_report(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Report {report_id} not found",
        )

    try:
        writer = EmbeddingWriter(conn=conn, embedding_service=embedding_service)
        counts = await writer.embed_all(report_id)
        return EmbedResponse(**counts)
    except Exception as exc:
        logger.error(
            "Embedding generation failed for report %s: %s",
            report_id,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Embedding generation failed: {exc}",
        ) from exc
