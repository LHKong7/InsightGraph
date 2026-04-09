from __future__ import annotations

import logging
from typing import Any

import litellm

logger = logging.getLogger(__name__)


class VectorRetriever:
    """Semantic search using Neo4j vector index (MVP) or external vector DB.

    Uses Neo4j's built-in vector index (5.11+) for MVP to avoid additional
    infrastructure. Can be upgraded to Qdrant later.
    """

    def __init__(
        self,
        conn: Any,
        embedding_model: str = "text-embedding-3-small",
        api_key: str = "",
    ):
        self._conn = conn
        self._embedding_model = embedding_model
        self._api_key = api_key

    async def _embed(self, text: str) -> list[float]:
        """Generate embedding for a text string."""
        kwargs: dict = {
            "model": self._embedding_model,
            "input": [text],
        }
        if self._api_key:
            kwargs["api_key"] = self._api_key

        response = await litellm.aembedding(**kwargs)
        return response.data[0]["embedding"]

    async def search_paragraphs(self, query: str, top_k: int = 10) -> list[dict]:
        """Semantic search over paragraph embeddings using Neo4j vector index.

        Note: This requires the vector index to be set up. For MVP, falls back
        to fulltext search if vector index is not available.
        """
        try:
            query_embedding = await self._embed(query)
            async with self._conn.session() as session:
                result = await session.run(
                    """
                    CALL db.index.vector.queryNodes('paragraph_embeddings', $top_k, $embedding)
                    YIELD node, score
                    RETURN node.paragraph_id AS paragraph_id,
                           node.text AS text,
                           node.page AS page,
                           score
                    ORDER BY score DESC
                    """,
                    {"top_k": top_k, "embedding": query_embedding},
                )
                return [dict(record) async for record in result]
        except Exception:
            logger.warning("Vector search failed, falling back to fulltext", exc_info=True)
            return await self._fulltext_fallback(query, top_k)

    async def _fulltext_fallback(self, query: str, top_k: int) -> list[dict]:
        """Fallback to fulltext search when vector index is unavailable."""
        async with self._conn.session() as session:
            result = await session.run(
                """
                CALL db.index.fulltext.queryNodes('claim_search', $query)
                YIELD node, score
                RETURN node.claim_id AS id,
                       node.text AS text,
                       score
                ORDER BY score DESC
                LIMIT $limit
                """,
                {"query": query, "limit": top_k},
            )
            return [dict(record) async for record in result]
