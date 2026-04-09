from __future__ import annotations

from typing import Any

from insightgraph_graph.connection import Neo4jConnection


class GraphReader:
    """Parameterized read queries against the Neo4j document graph."""

    def __init__(self, conn: Neo4jConnection) -> None:
        self._conn = conn

    # ------------------------------------------------------------------
    # Entity queries
    # ------------------------------------------------------------------

    async def find_entities(
        self,
        name: str | None = None,
        entity_type: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search entities by fulltext name and/or type filter.

        When *name* is provided the fulltext index ``entity_search`` is used.
        When only *entity_type* is provided a label scan with filter is used.
        """
        if name:
            query = "CALL db.index.fulltext.queryNodes('entity_search', $query) YIELD node, score "
            if entity_type:
                query += "WHERE node.entity_type = $entity_type "
            query += "RETURN properties(node) AS entity, score ORDER BY score DESC LIMIT $limit"
            params: dict[str, Any] = {"query": name, "limit": limit}
            if entity_type:
                params["entity_type"] = entity_type
        else:
            query = "MATCH (node:Entity) "
            if entity_type:
                query += "WHERE node.entity_type = $entity_type "
            query += "RETURN properties(node) AS entity LIMIT $limit"
            params = {"limit": limit}
            if entity_type:
                params["entity_type"] = entity_type

        async with self._conn.session() as session:
            result = await session.run(query, params)
            records = await result.data()
        return records

    async def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        """Return a single entity by its ``entity_id``."""
        query = "MATCH (e:Entity {entity_id: $entity_id}) RETURN properties(e) AS entity"
        async with self._conn.session() as session:
            result = await session.run(query, entity_id=entity_id)
            record = await result.single()
        if record is None:
            return None
        return dict(record["entity"])

    # ------------------------------------------------------------------
    # Claim queries
    # ------------------------------------------------------------------

    async def get_claims_about(self, entity_name: str) -> list[dict[str, Any]]:
        """Return claims connected to an entity via MENTIONS or ABOUT."""
        query = (
            "MATCH (e:Entity)<-[:MENTIONS|ABOUT]-(c:Claim) "
            "WHERE e.canonical_name = $entity_name OR e.name = $entity_name "
            "RETURN properties(c) AS claim, properties(e) AS entity"
        )
        async with self._conn.session() as session:
            result = await session.run(query, entity_name=entity_name)
            records = await result.data()
        return records

    async def find_evidence_for_claim(self, claim_id: str) -> list[dict[str, Any]]:
        """Return source spans supporting a given claim."""
        query = (
            "MATCH (c:Claim {claim_id: $claim_id})-[:SUPPORTED_BY]->(s:SourceSpan) "
            "RETURN properties(s) AS span"
        )
        async with self._conn.session() as session:
            result = await session.run(query, claim_id=claim_id)
            records = await result.data()
        return records

    # ------------------------------------------------------------------
    # Metric queries
    # ------------------------------------------------------------------

    async def get_metric_history(
        self,
        metric_name: str,
        entity_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return metric values ordered by period, optionally scoped to an entity."""
        if entity_name:
            query = (
                "MATCH (e:Entity)-[:HAS_VALUE]->(mv:MetricValue)-[:MEASURES]->(m:Metric) "
                "WHERE m.name = $metric_name "
                "  AND (e.canonical_name = $entity_name OR e.name = $entity_name) "
                "RETURN properties(mv) AS metric_value, "
                "       properties(m) AS metric, "
                "       properties(e) AS entity "
                "ORDER BY mv.period"
            )
            params: dict[str, Any] = {
                "metric_name": metric_name,
                "entity_name": entity_name,
            }
        else:
            query = (
                "MATCH (mv:MetricValue)-[:MEASURES]->(m:Metric) "
                "WHERE m.name = $metric_name "
                "RETURN properties(mv) AS metric_value, "
                "       properties(m) AS metric "
                "ORDER BY mv.period"
            )
            params = {"metric_name": metric_name}

        async with self._conn.session() as session:
            result = await session.run(query, params)
            records = await result.data()
        return records

    # ------------------------------------------------------------------
    # Subgraph / neighbourhood
    # ------------------------------------------------------------------

    async def get_subgraph(self, node_id: str, depth: int = 2) -> dict[str, Any]:
        """Return a neighbourhood subgraph around a node up to *depth* hops.

        Finds the node by any ``*_id`` property, then expands variable-length
        paths returning all distinct nodes and relationships.
        """
        query = (
            "MATCH (start) "
            "WHERE start.entity_id = $node_id "
            "   OR start.report_id = $node_id "
            "   OR start.section_id = $node_id "
            "   OR start.paragraph_id = $node_id "
            "   OR start.claim_id = $node_id "
            "   OR start.metric_id = $node_id "
            "   OR start.value_id = $node_id "
            "   OR start.span_id = $node_id "
            "WITH start "
            "MATCH path = (start)-[*1.." + str(int(depth)) + "]-(neighbour) "
            "UNWIND relationships(path) AS rel "
            "UNWIND nodes(path) AS n "
            "WITH collect(DISTINCT {id: elementId(n), labels: labels(n), "
            "             props: properties(n)}) AS nodes, "
            "     collect(DISTINCT {id: elementId(rel), type: type(rel), "
            "             startId: elementId(startNode(rel)), "
            "             endId: elementId(endNode(rel)), "
            "             props: properties(rel)}) AS edges "
            "RETURN nodes, edges"
        )
        async with self._conn.session() as session:
            result = await session.run(query, node_id=node_id)
            record = await result.single()
        if record is None:
            return {"nodes": [], "edges": []}
        return {"nodes": record["nodes"], "edges": record["edges"]}

    # ------------------------------------------------------------------
    # Report queries
    # ------------------------------------------------------------------

    async def get_report(self, report_id: str) -> dict[str, Any] | None:
        """Return a single report by its ``report_id``."""
        query = "MATCH (r:Report {report_id: $report_id}) RETURN properties(r) AS report"
        async with self._conn.session() as session:
            result = await session.run(query, report_id=report_id)
            record = await result.single()
        if record is None:
            return None
        return dict(record["report"])

    async def list_reports(self) -> list[dict[str, Any]]:
        """Return all report nodes."""
        query = "MATCH (r:Report) RETURN properties(r) AS report ORDER BY r.date DESC"
        async with self._conn.session() as session:
            result = await session.run(query)
            records = await result.data()
        return records
