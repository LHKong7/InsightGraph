from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from pydantic import BaseModel, Field

from insightgraph_retriever.graph_retriever import GraphRetriever
from insightgraph_retriever.vector_retriever import VectorRetriever

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Structured result model
# ------------------------------------------------------------------


class RetrievalResult(BaseModel):
    """Structured output of a hybrid retrieval pass."""

    paragraphs: list[dict[str, Any]] = Field(default_factory=list)
    claims: list[dict[str, Any]] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)
    metrics: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)


# ------------------------------------------------------------------
# Reciprocal Rank Fusion helper
# ------------------------------------------------------------------


def _rrf_score(rank: int, k: int = 60) -> float:
    """Compute the RRF contribution for a result at *rank* (0-based)."""
    return 1.0 / (k + rank + 1)


def _result_key(result: dict[str, Any]) -> str:
    """Derive a stable identity key from a result dict."""
    for id_field in ("paragraph_id", "claim_id", "entity_id", "value_id"):
        if result.get(id_field):
            return f"{id_field}:{result[id_field]}"
    text = result.get("text", "")
    return f"text:{hash(text)}"


# ------------------------------------------------------------------
# HybridRetriever — GRAPH-FIRST architecture
# ------------------------------------------------------------------


class HybridRetriever:
    """Graph-first hybrid retriever.

    Unlike typical RAG systems that start with vector search, this retriever
    leads with graph queries and uses vector search as a supplement.

    Flow:
    1. Graph-first: fulltext entity search -> expand neighborhoods
       (claims, metrics, relationships, evidence)
    2. Vector supplement: semantic search in parallel for matches the
       graph might miss
    3. Graph-enriched fusion: merge with RRF, graph weighted higher

    Parameters
    ----------
    graph_weight:
        Default 0.6 — graph is primary.
    vector_weight:
        Default 0.4 — vector is supplementary.
    """

    def __init__(
        self,
        graph_retriever: GraphRetriever,
        vector_retriever: VectorRetriever,
        graph_weight: float = 0.6,
        vector_weight: float = 0.4,
    ):
        self._graph = graph_retriever
        self._vector = vector_retriever
        self._graph_weight = graph_weight
        self._vector_weight = vector_weight

    async def search(
        self,
        query: str,
        top_k: int = 10,
        report_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Graph-first hybrid search with RRF fusion.

        1. Graph: entity fulltext search -> expand to claims, relationships
        2. Vector: parallel semantic search
        3. Merge with graph-weighted RRF
        """

        # --- Step 1: GRAPH-FIRST ---
        graph_results: list[dict[str, Any]] = []
        entity_names: set[str] = set()

        # 1a) Find entities matching the query via fulltext
        found_entities = await self._graph.find_entities(
            name=query,
            report_id=report_id,
            limit=top_k,
        )
        for entity_rec in found_entities:
            entity_data = entity_rec.get("entity", entity_rec)
            entity_data["result_type"] = "entity"
            graph_results.append(entity_data)
            ename = entity_data.get("canonical_name") or entity_data.get("name")
            if ename:
                entity_names.add(ename)

        # 1b) Expand entity neighborhoods: claims about each entity
        for ename in list(entity_names):
            claims = await self._graph.get_claims_about(ename, report_id=report_id)
            for claim_rec in claims:
                claim_data = claim_rec.get("claim", claim_rec)
                claim_data["result_type"] = "claim"
                claim_data.setdefault("mentioned_entity", ename)
                graph_results.append(claim_data)

        # --- Step 2: VECTOR SUPPLEMENT (parallel-capable) ---
        vector_results = await self._vector.search_all(query, top_k=top_k)

        if report_id:
            vector_results = [
                r
                for r in vector_results
                if r.get("report_id") == report_id or r.get("report_id") is None
            ]

        # Extract additional entity names from vector hits
        for hit in vector_results:
            for entity in hit.get("entities", []):
                name = entity.get("name")
                if name:
                    entity_names.add(name)

        # --- Step 3: RRF merge (graph-weighted) ---
        scores: dict[str, float] = defaultdict(float)
        result_map: dict[str, dict[str, Any]] = {}
        source_map: dict[str, set[str]] = defaultdict(set)

        # Graph results scored first (higher weight)
        for rank, item in enumerate(graph_results):
            key = _result_key(item)
            scores[key] += self._graph_weight * _rrf_score(rank)
            result_map[key] = item
            source_map[key].add("graph")

        # Vector results scored second
        for rank, item in enumerate(vector_results):
            key = _result_key(item)
            scores[key] += self._vector_weight * _rrf_score(rank)
            if key not in result_map:
                result_map[key] = item
            source_map[key].add("vector")

        # Sort and annotate
        ranked_keys = sorted(scores, key=lambda k: scores[k], reverse=True)
        merged: list[dict[str, Any]] = []
        for key in ranked_keys[:top_k]:
            item = dict(result_map[key])
            sources = source_map[key]
            item["source"] = "both" if len(sources) > 1 else next(iter(sources))
            item["rrf_score"] = round(scores[key], 6)
            merged.append(item)

        return merged

    async def retrieve_for_question(
        self,
        question: str,
        top_k: int = 10,
    ) -> RetrievalResult:
        """High-level retrieval returning structured RetrievalResult.

        Uses graph-first search, then enriches with entity metrics via
        get_entity_metrics (not requiring a metric_name).
        """
        results = await self.search(question, top_k=top_k)

        paragraphs: list[dict[str, Any]] = []
        claims: list[dict[str, Any]] = []
        entities: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = []
        seen_entity_names: set[str] = set()

        for item in results:
            result_type = item.get("result_type", "")
            sources.append(
                {
                    "key": _result_key(item),
                    "source": item.get("source", "unknown"),
                    "rrf_score": item.get("rrf_score", 0.0),
                    "result_type": result_type,
                }
            )
            if result_type == "paragraph":
                paragraphs.append(item)
            elif result_type == "claim":
                claims.append(item)
                for entity in item.get("entities", []):
                    name = entity.get("name")
                    if name:
                        seen_entity_names.add(name)
                me = item.get("mentioned_entity")
                if me:
                    seen_entity_names.add(me)
            elif result_type == "entity":
                entities.append(item)
                name = item.get("canonical_name") or item.get("name")
                if name:
                    seen_entity_names.add(name)

        # Fetch metrics using get_entity_metrics (no metric_name required)
        metrics: list[dict[str, Any]] = []
        for ename in list(seen_entity_names)[:5]:
            try:
                metric_rows = await self._graph._reader.get_entity_metrics(ename)
                metrics.extend(metric_rows)
            except Exception:
                logger.debug("Metric lookup failed for %s", ename, exc_info=True)

        return RetrievalResult(
            paragraphs=paragraphs,
            claims=claims,
            entities=entities,
            metrics=metrics,
            sources=sources,
        )
