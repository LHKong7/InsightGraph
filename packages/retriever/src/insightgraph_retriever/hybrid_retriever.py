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
    for id_field in (
        "paragraph_id",
        "claim_id",
        "entity_id",
        "value_id",
    ):
        if result.get(id_field):
            return f"{id_field}:{result[id_field]}"
    # Fall back to text hash when no id is present
    text = result.get("text", "")
    return f"text:{hash(text)}"


# ------------------------------------------------------------------
# HybridRetriever
# ------------------------------------------------------------------


class HybridRetriever:
    """Merges graph-structured and vector-similarity results via RRF.

    Parameters
    ----------
    graph_retriever:
        Provides entity / claim / metric lookups from the knowledge graph.
    vector_retriever:
        Provides semantic similarity search over paragraph and claim
        embeddings.
    graph_weight:
        Multiplier applied to graph-sourced RRF scores.
    vector_weight:
        Multiplier applied to vector-sourced RRF scores.
    """

    def __init__(
        self,
        graph_retriever: GraphRetriever,
        vector_retriever: VectorRetriever,
        graph_weight: float = 0.4,
        vector_weight: float = 0.6,
    ):
        self._graph = graph_retriever
        self._vector = vector_retriever
        self._graph_weight = graph_weight
        self._vector_weight = vector_weight

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def search(
        self,
        query: str,
        top_k: int = 10,
        report_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Run hybrid search: vector + graph, merged with RRF scoring.

        1. Vector search over paragraphs and claims.
        2. Extract entity names mentioned in the top vector hits.
        3. Run graph queries (``find_entities``, ``get_claims_about``) for
           each extracted entity.
        4. Merge all results using Reciprocal Rank Fusion.
        5. Return the top *top_k* results, each annotated with a ``source``
           field indicating ``"graph"``, ``"vector"``, or ``"both"``.
        """

        # --- Step 1: vector results ---
        vector_results = await self._vector.search_all(query, top_k=top_k)

        # Optional report-level filter
        if report_id:
            vector_results = [
                r
                for r in vector_results
                if r.get("report_id") == report_id or r.get("report_id") is None
            ]

        # --- Step 2: extract entity names from top vector hits ---
        entity_names: set[str] = set()
        for hit in vector_results[:top_k]:
            for entity in hit.get("entities", []):
                name = entity.get("name")
                if name:
                    entity_names.add(name)

        # --- Step 3: graph queries ---
        graph_results: list[dict[str, Any]] = []

        # 3a) Entity search using the query itself
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

        # 3b) Claims about each discovered entity
        for ename in list(entity_names):
            claims = await self._graph.get_claims_about(
                ename,
                report_id=report_id,
            )
            for claim_rec in claims:
                claim_data = claim_rec.get("claim", claim_rec)
                claim_data["result_type"] = "claim"
                claim_data.setdefault("mentioned_entity", ename)
                graph_results.append(claim_data)

        # --- Step 4: RRF merge ---
        scores: dict[str, float] = defaultdict(float)
        result_map: dict[str, dict[str, Any]] = {}
        source_map: dict[str, set[str]] = defaultdict(set)

        for rank, item in enumerate(vector_results):
            key = _result_key(item)
            scores[key] += self._vector_weight * _rrf_score(rank)
            result_map[key] = item
            source_map[key].add("vector")

        for rank, item in enumerate(graph_results):
            key = _result_key(item)
            scores[key] += self._graph_weight * _rrf_score(rank)
            if key not in result_map:
                result_map[key] = item
            source_map[key].add("graph")

        # --- Step 5: sort and annotate ---
        ranked_keys = sorted(scores, key=lambda k: scores[k], reverse=True)
        merged: list[dict[str, Any]] = []
        for key in ranked_keys[:top_k]:
            item = dict(result_map[key])
            sources = source_map[key]
            if len(sources) > 1:
                item["source"] = "both"
            else:
                item["source"] = next(iter(sources))
            item["rrf_score"] = round(scores[key], 6)
            merged.append(item)

        return merged

    async def retrieve_for_question(
        self,
        question: str,
        top_k: int = 10,
    ) -> RetrievalResult:
        """High-level retrieval that returns a structured ``RetrievalResult``.

        Runs :meth:`search` and then partitions the results by type, also
        fetching metric history for any entities found.
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
                },
            )
            if result_type == "paragraph":
                paragraphs.append(item)
            elif result_type == "claim":
                claims.append(item)
                # Collect entity names from claims for metric lookup
                for entity in item.get("entities", []):
                    name = entity.get("name")
                    if name:
                        seen_entity_names.add(name)
            elif result_type == "entity":
                entities.append(item)
                name = item.get("canonical_name") or item.get("name")
                if name:
                    seen_entity_names.add(name)

        # Fetch metric history for discovered entities
        metrics: list[dict[str, Any]] = []
        for ename in list(seen_entity_names)[:5]:
            try:
                metric_rows = await self._graph.get_metric_history(
                    metric_name="",
                    entity_name=ename,
                )
                metrics.extend(metric_rows)
            except Exception:
                logger.debug(
                    "Metric lookup failed for entity %s",
                    ename,
                    exc_info=True,
                )

        return RetrievalResult(
            paragraphs=paragraphs,
            claims=claims,
            entities=entities,
            metrics=metrics,
            sources=sources,
        )
