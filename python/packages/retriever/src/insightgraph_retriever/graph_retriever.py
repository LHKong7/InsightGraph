from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class GraphRetriever:
    """High-level graph retrieval wrapping GraphReader with result formatting."""

    def __init__(self, reader: Any):
        self._reader = reader

    async def find_entities(
        self,
        name: str | None = None,
        entity_type: str | None = None,
        report_id: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Find entities matching criteria."""
        results = await self._reader.find_entities(name=name, entity_type=entity_type, limit=limit)
        if report_id:
            results = [r for r in results if report_id in r.get("report_ids", [])]
        return results

    async def get_claims_about(
        self,
        entity_name: str,
        claim_type: str | None = None,
        report_id: str | None = None,
    ) -> list[dict]:
        """Get all claims that mention an entity."""
        claims = await self._reader.get_claims_about(entity_name)
        if claim_type:
            claims = [c for c in claims if c.get("claim_type") == claim_type]
        if report_id:
            claims = [c for c in claims if c.get("report_id") == report_id]
        return claims

    async def get_metric_history(
        self,
        metric_name: str,
        entity_name: str | None = None,
    ) -> list[dict]:
        """Get historical values for a metric."""
        return await self._reader.get_metric_history(metric_name, entity_name)

    async def find_evidence_for_claim(self, claim_id: str) -> list[dict]:
        """Trace a claim back to its source text and location."""
        return await self._reader.find_evidence_for_claim(claim_id)

    async def get_subgraph(
        self,
        node_id: str,
        depth: int = 2,
        max_nodes: int = 50,
    ) -> dict:
        """Get a subgraph around a node."""
        return await self._reader.get_subgraph(node_id, depth)
