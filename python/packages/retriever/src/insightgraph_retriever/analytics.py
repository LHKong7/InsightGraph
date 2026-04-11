from __future__ import annotations

import logging
from typing import Any

from insightgraph_graph.connection import Neo4jConnection

logger = logging.getLogger(__name__)


class GraphAnalytics:
    """Graph analytics: centrality, community detection, entity similarity."""

    def __init__(self, conn: Neo4jConnection):
        self._conn = conn

    async def entity_importance(self, top_k: int = 20) -> list[dict[str, Any]]:
        """Rank entities by degree centrality (number of connections)."""
        query = (
            "MATCH (e:Entity)-[r]-() "
            "WITH e, count(r) AS degree "
            "RETURN e.entity_id AS entity_id, "
            "       coalesce(e.canonical_name, e.name) AS name, "
            "       e.entity_type AS entity_type, "
            "       degree "
            "ORDER BY degree DESC "
            "LIMIT $top_k"
        )
        async with self._conn.session() as session:
            result = await session.run(query, top_k=top_k)
            return await result.data()

    async def most_claimed_entities(self, top_k: int = 20) -> list[dict[str, Any]]:
        """Find entities with the most claims about them."""
        query = (
            "MATCH (e:Entity)<-[:MENTIONS|ABOUT]-(c:Claim) "
            "WITH e, count(c) AS claim_count "
            "RETURN e.entity_id AS entity_id, "
            "       coalesce(e.canonical_name, e.name) AS name, "
            "       e.entity_type AS entity_type, "
            "       claim_count "
            "ORDER BY claim_count DESC "
            "LIMIT $top_k"
        )
        async with self._conn.session() as session:
            result = await session.run(query, top_k=top_k)
            return await result.data()

    async def entity_co_occurrence(
        self,
        entity_name: str,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Find entities that frequently co-occur with the given entity in claims."""
        query = (
            "MATCH (e1:Entity)<-[:MENTIONS|ABOUT]-(c:Claim)-[:MENTIONS|ABOUT]->(e2:Entity) "
            "WHERE (e1.canonical_name = $name OR e1.name = $name) "
            "  AND e1 <> e2 "
            "WITH e2, count(c) AS co_occurrences "
            "RETURN coalesce(e2.canonical_name, e2.name) AS name, "
            "       e2.entity_type AS entity_type, "
            "       co_occurrences "
            "ORDER BY co_occurrences DESC "
            "LIMIT $top_k"
        )
        async with self._conn.session() as session:
            result = await session.run(query, name=entity_name, top_k=top_k)
            return await result.data()

    async def report_coverage(self, report_id: str) -> dict[str, Any]:
        """Compute coverage statistics for a report."""
        query = (
            "MATCH (r:Report {report_id: $report_id}) "
            "OPTIONAL MATCH (r)-[:HAS_SECTION]->(s:Section) "
            "OPTIONAL MATCH (s)-[:HAS_PARAGRAPH]->(p:Paragraph) "
            "OPTIONAL MATCH (p)-[:ASSERTS]->(c:Claim) "
            "OPTIONAL MATCH (p)-[:MENTIONS]->(e:Entity) "
            "OPTIONAL MATCH (e)-[:HAS_VALUE]->(mv:MetricValue) "
            "OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(span:SourceSpan) "
            "RETURN r.title AS title, "
            "       count(DISTINCT s) AS section_count, "
            "       count(DISTINCT p) AS paragraph_count, "
            "       count(DISTINCT c) AS claim_count, "
            "       count(DISTINCT e) AS entity_count, "
            "       count(DISTINCT mv) AS metric_value_count, "
            "       count(DISTINCT span) AS evidence_count, "
            "       CASE WHEN count(DISTINCT c) > 0 "
            "            THEN toFloat(count(DISTINCT span)) / count(DISTINCT c) "
            "            ELSE 0.0 END AS evidence_coverage_ratio"
        )
        async with self._conn.session() as session:
            result = await session.run(query, report_id=report_id)
            record = await result.single()
        if record is None:
            return {}
        return dict(record)

    async def graph_summary(self) -> dict[str, Any]:
        """Return overall graph statistics."""
        queries = {
            "reports": "MATCH (n:Report) RETURN count(n) AS count",
            "entities": "MATCH (n:Entity) RETURN count(n) AS count",
            "claims": "MATCH (n:Claim) RETURN count(n) AS count",
            "metrics": "MATCH (n:Metric) RETURN count(n) AS count",
            "metric_values": "MATCH (n:MetricValue) RETURN count(n) AS count",
            "paragraphs": "MATCH (n:Paragraph) RETURN count(n) AS count",
            "relationships": "MATCH ()-[r]->() RETURN count(r) AS count",
        }
        stats: dict[str, Any] = {}
        async with self._conn.session() as session:
            for label, query in queries.items():
                result = await session.run(query)
                record = await result.single()
                stats[label] = record["count"] if record else 0
        return stats

    async def multi_report_entities(self, min_reports: int = 2) -> list[dict[str, Any]]:
        """Find entities that appear in multiple reports."""
        query = (
            "MATCH (e:Entity)-[:SOURCED_FROM]->(r:Report) "
            "WITH e, count(DISTINCT r) AS report_count, "
            "     collect(r.title) AS report_titles "
            "WHERE report_count >= $min_reports "
            "RETURN coalesce(e.canonical_name, e.name) AS name, "
            "       e.entity_type AS entity_type, "
            "       report_count, "
            "       report_titles "
            "ORDER BY report_count DESC"
        )
        async with self._conn.session() as session:
            result = await session.run(query, min_reports=min_reports)
            return await result.data()
