from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from insightgraph_retriever.embeddings import EmbeddingService

from insightgraph_graph.connection import Neo4jConnection

logger = logging.getLogger(__name__)

BATCH_WRITE_SIZE = 100


class EmbeddingWriter:
    """Generates and stores embeddings for Paragraph and Claim nodes.

    Used both during initial ingestion and for backfilling existing data.
    """

    def __init__(self, conn: Neo4jConnection, embedding_service: EmbeddingService):
        self._conn = conn
        self._embedding_service = embedding_service

    async def embed_report_paragraphs(self, report_id: str) -> int:
        """Generate embeddings for all paragraphs in a report that lack them."""
        async with self._conn.session() as session:
            result = await session.run(
                "MATCH (r:Report {report_id: $report_id})"
                "-[:HAS_SECTION]->(:Section)-[:HAS_PARAGRAPH]->(p:Paragraph) "
                "WHERE p.embedding IS NULL "
                "RETURN p.paragraph_id AS id, p.text AS text",
                {"report_id": report_id},
            )
            records = [dict(r) async for r in result]

        if not records:
            return 0

        ids = [r["id"] for r in records]
        texts = [r["text"] for r in records]
        embeddings = await self._embedding_service.embed_batch(texts)

        await self._write_embeddings("Paragraph", "paragraph_id", ids, embeddings)
        logger.info("Embedded %d paragraphs for report %s", len(ids), report_id)
        return len(ids)

    async def embed_report_claims(self, report_id: str) -> int:
        """Generate embeddings for all claims in a report that lack them."""
        async with self._conn.session() as session:
            result = await session.run(
                "MATCH (r:Report {report_id: $report_id})"
                "-[:HAS_SECTION]->(:Section)-[:HAS_PARAGRAPH]->(p:Paragraph)"
                "-[:ASSERTS]->(c:Claim) "
                "WHERE c.embedding IS NULL "
                "RETURN DISTINCT c.claim_id AS id, c.text AS text",
                {"report_id": report_id},
            )
            records = [dict(r) async for r in result]

        if not records:
            return 0

        ids = [r["id"] for r in records]
        texts = [r["text"] for r in records]
        embeddings = await self._embedding_service.embed_batch(texts)

        await self._write_embeddings("Claim", "claim_id", ids, embeddings)
        logger.info("Embedded %d claims for report %s", len(ids), report_id)
        return len(ids)

    async def embed_all(self, report_id: str) -> dict:
        """Embed both paragraphs and claims for a report."""
        para_count = await self.embed_report_paragraphs(report_id)
        claim_count = await self.embed_report_claims(report_id)
        return {"paragraphs_embedded": para_count, "claims_embedded": claim_count}

    async def _write_embeddings(
        self,
        label: str,
        id_property: str,
        ids: list[str],
        embeddings: list[list[float]],
    ) -> None:
        """Write embeddings back to Neo4j in batches via UNWIND."""
        for i in range(0, len(ids), BATCH_WRITE_SIZE):
            batch = [
                {"id": ids[j], "embedding": embeddings[j]}
                for j in range(i, min(i + BATCH_WRITE_SIZE, len(ids)))
            ]
            async with self._conn.session() as session:
                await session.run(
                    f"UNWIND $batch AS item "
                    f"MATCH (n:{label} {{{id_property}: item.id}}) "
                    f"SET n.embedding = item.embedding",
                    {"batch": batch},
                )
