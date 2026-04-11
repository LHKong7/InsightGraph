from __future__ import annotations

import logging
from typing import Any

from insightgraph_retriever.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


class VectorRetriever:
    """Semantic search using Neo4j vector indexes (5.11+).

    Delegates embedding generation to ``EmbeddingService`` and enriches
    raw vector hits with graph context (section title, report title, page
    number, related entities, etc.) via OPTIONAL MATCH joins.
    """

    def __init__(self, conn: Any, embedding_service: EmbeddingService):
        self._conn = conn
        self._embedding_service = embedding_service

    # ------------------------------------------------------------------
    # Paragraph search
    # ------------------------------------------------------------------

    async def search_paragraphs(
        self,
        query: str,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Embed *query* and search the ``paragraph_embedding_vector`` index.

        Results are enriched with section title, report title and page number
        by traversing the graph from Paragraph back to Section and Report.
        """
        query_embedding = await self._embedding_service.embed_text(query)

        cypher = """
            CALL db.index.vector.queryNodes(
                'paragraph_embedding_vector', $top_k, $embedding
            )
            YIELD node, score
            OPTIONAL MATCH (node)<-[:HAS_PARAGRAPH]-(s:Section)
            OPTIONAL MATCH (s)<-[:HAS_SECTION]-(r:Report)
            RETURN node.paragraph_id  AS paragraph_id,
                   node.text          AS text,
                   node.page          AS page,
                   s.title            AS section_title,
                   r.title            AS report_title,
                   r.report_id        AS report_id,
                   score
            ORDER BY score DESC
        """

        try:
            async with self._conn.session() as session:
                result = await session.run(
                    cypher,
                    {"top_k": top_k, "embedding": query_embedding},
                )
                records = await result.data()
            return [{**record, "result_type": "paragraph"} for record in records]
        except Exception:
            logger.warning(
                "Vector paragraph search failed",
                exc_info=True,
            )
            return []

    # ------------------------------------------------------------------
    # Claim search
    # ------------------------------------------------------------------

    async def search_claims(
        self,
        query: str,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Embed *query* and search the ``claim_embedding_vector`` index.

        Results are enriched with supporting evidence (source spans) and
        mentioned entities.
        """
        query_embedding = await self._embedding_service.embed_text(query)

        cypher = """
            CALL db.index.vector.queryNodes(
                'claim_embedding_vector', $top_k, $embedding
            )
            YIELD node, score
            OPTIONAL MATCH (node)-[:SUPPORTED_BY]->(span:SourceSpan)
            OPTIONAL MATCH (node)-[:MENTIONS|ABOUT]->(e:Entity)
            WITH node, score,
                 collect(DISTINCT properties(span)) AS evidence,
                 collect(DISTINCT {
                     entity_id: e.entity_id,
                     name: coalesce(e.canonical_name, e.name),
                     entity_type: e.entity_type
                 }) AS entities
            RETURN node.claim_id   AS claim_id,
                   node.text       AS text,
                   node.claim_type AS claim_type,
                   score,
                   evidence,
                   entities
            ORDER BY score DESC
        """

        try:
            async with self._conn.session() as session:
                result = await session.run(
                    cypher,
                    {"top_k": top_k, "embedding": query_embedding},
                )
                records = await result.data()
            # Filter out null-only entity dicts that arise from OPTIONAL MATCH
            for record in records:
                record["entities"] = [
                    e for e in record.get("entities", []) if e.get("entity_id") is not None
                ]
                record["evidence"] = [
                    e
                    for e in record.get("evidence", [])
                    if e  # drop empty dicts from null spans
                ]
                record["result_type"] = "claim"
            return records
        except Exception:
            logger.warning(
                "Vector claim search failed",
                exc_info=True,
            )
            return []

    # ------------------------------------------------------------------
    # Unified search
    # ------------------------------------------------------------------

    async def search_all(
        self,
        query: str,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Search both paragraph and claim indexes, merge by score.

        Each index returns up to *top_k* results; the merged list is
        re-sorted by score and truncated to *top_k*.
        """
        paragraphs = await self.search_paragraphs(query, top_k=top_k)
        claims = await self.search_claims(query, top_k=top_k)

        merged = paragraphs + claims
        merged.sort(key=lambda r: r.get("score", 0.0), reverse=True)
        return merged[:top_k]
