from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

from neo4j import AsyncManagedTransaction

from insightgraph_core.ir.extraction import (
    ExtractionResult,
    ResolvedEntity,
)
from insightgraph_core.ir.models import DocumentIR, SectionNode, TableBlock
from insightgraph_graph.connection import Neo4jConnection

logger = logging.getLogger(__name__)

# Allowed relationship type labels.  Only these will be written as typed edges
# in Neo4j.  Using string formatting for the relationship type is safe because
# the value is validated against this fixed set before being interpolated.
_VALID_RELATIONSHIP_TYPES = frozenset(
    {
        "SUBSIDIARY_OF",
        "CEO_OF",
        "FOUNDER_OF",
        "BOARD_MEMBER_OF",
        "COMPETES_WITH",
        "PARTNERS_WITH",
        "INVESTED_IN",
        "SUPPLIES_TO",
        "ACQUIRED",
        "MERGED_WITH",
        "REGULATES",
        "OPERATES_IN",
        "EMPLOYS",
    }
)


class GraphWriter:
    """Writes a fully-parsed document and its extractions into Neo4j."""

    def __init__(self, conn: Neo4jConnection) -> None:
        self._conn = conn

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def write_document(
        self, doc: DocumentIR, extractions: ExtractionResult
    ) -> dict[str, Any]:
        """Persist a complete document graph inside a single transaction.

        Returns a summary dict with counts of created nodes/edges.
        """
        async with self._conn.session() as session:
            result = await session.execute_write(lambda tx: self._write_all(tx, doc, extractions))
        return result

    # ------------------------------------------------------------------
    # Transaction body
    # ------------------------------------------------------------------

    @staticmethod
    async def _write_all(
        tx: AsyncManagedTransaction,
        doc: DocumentIR,
        extractions: ExtractionResult,
    ) -> dict[str, Any]:
        counts: dict[str, int] = {
            "reports": 0,
            "sections": 0,
            "paragraphs": 0,
            "source_spans": 0,
            "entities": 0,
            "metrics": 0,
            "metric_values": 0,
            "claims": 0,
            "relationships": 0,
            "edges": 0,
        }

        report_id = str(doc.id)

        # --- Report -------------------------------------------------------
        await tx.run(
            "MERGE (r:Report {report_id: $report_id}) "
            "SET r.title = $title, "
            "    r.source_filename = $source_filename, "
            "    r.date = $date, "
            "    r.num_pages = $num_pages",
            report_id=report_id,
            title=doc.title or doc.source_filename,
            source_filename=doc.source_filename,
            date=doc.date,
            num_pages=doc.num_pages,
        )
        counts["reports"] += 1

        # --- Sections & nested blocks ------------------------------------
        block_id_map: dict[UUID, str] = {}  # block model id -> paragraph neo4j id

        async def _write_section(section: SectionNode, parent_id: str | None) -> None:
            section_id = str(section.id)
            await tx.run(
                "MERGE (s:Section {section_id: $section_id}) "
                "SET s.title = $title, s.level = $level, s.order = $order",
                section_id=section_id,
                title=section.title,
                level=section.level,
                order=section.order,
            )
            counts["sections"] += 1

            if parent_id is None:
                # Top-level section -> Report
                await tx.run(
                    "MATCH (r:Report {report_id: $report_id}) "
                    "MATCH (s:Section {section_id: $section_id}) "
                    "MERGE (r)-[:HAS_SECTION]->(s)",
                    report_id=report_id,
                    section_id=section_id,
                )
            else:
                # Nested section -> parent section
                await tx.run(
                    "MATCH (p:Section {section_id: $parent_id}) "
                    "MATCH (s:Section {section_id: $section_id}) "
                    "MERGE (p)-[:HAS_SECTION]->(s)",
                    parent_id=parent_id,
                    section_id=section_id,
                )
            counts["edges"] += 1

            # Blocks (paragraphs, tables, etc.)
            for block in section.blocks:
                para_id = str(block.id)
                block_id_map[block.id] = para_id

                text = block.content
                if isinstance(block, TableBlock) and block.caption:
                    text = f"{block.caption}\n{text}"

                await tx.run(
                    "MERGE (p:Paragraph {paragraph_id: $paragraph_id}) "
                    "SET p.text = $text, p.page = $page",
                    paragraph_id=para_id,
                    text=text,
                    page=block.source_span.page,
                )
                counts["paragraphs"] += 1

                await tx.run(
                    "MATCH (s:Section {section_id: $section_id}) "
                    "MATCH (p:Paragraph {paragraph_id: $paragraph_id}) "
                    "MERGE (s)-[:HAS_PARAGRAPH]->(p)",
                    section_id=section_id,
                    paragraph_id=para_id,
                )
                counts["edges"] += 1

                # SourceSpan for the block
                span_id = str(uuid4())
                await tx.run(
                    "MERGE (sp:SourceSpan {span_id: $span_id}) "
                    "SET sp.text = $text, "
                    "    sp.page = $page, "
                    "    sp.start_char = $start_char, "
                    "    sp.end_char = $end_char, "
                    "    sp.block_id = $block_id",
                    span_id=span_id,
                    text=block.source_span.text,
                    page=block.source_span.page,
                    start_char=block.source_span.start_char,
                    end_char=block.source_span.end_char,
                    block_id=para_id,
                )
                counts["source_spans"] += 1

                await tx.run(
                    "MATCH (p:Paragraph {paragraph_id: $paragraph_id}) "
                    "MATCH (sp:SourceSpan {span_id: $span_id}) "
                    "MERGE (p)-[:HAS_SPAN]->(sp)",
                    paragraph_id=para_id,
                    span_id=span_id,
                )
                counts["edges"] += 1

            # Recurse into child sections
            for child in section.children:
                await _write_section(child, section_id)

        for section in doc.sections:
            await _write_section(section, parent_id=None)

        # --- Build resolved-entity lookup ---------------------------------
        resolved_map: dict[str, ResolvedEntity] = {}
        for re in extractions.resolved_entities:
            resolved_map[re.canonical_name.lower()] = re
            for alias in re.aliases:
                resolved_map[alias.lower()] = re

        # --- Entities (MERGE on canonical_name + entity_type) -------------
        entity_node_map: dict[str, str] = {}  # canonical_name_lower -> entity_id

        for entity in extractions.entities:
            resolved = resolved_map.get(entity.name.lower())
            canonical = resolved.canonical_name if resolved else entity.name
            description = resolved.description if resolved else entity.description
            aliases = resolved.aliases if resolved else []
            entity_type = resolved.type.value if resolved else entity.type.value
            canon_lower = canonical.lower()

            if canon_lower in entity_node_map:
                # Already written in this transaction
                continue

            entity_id = str(uuid4())
            entity_node_map[canon_lower] = entity_id

            await tx.run(
                "MERGE (e:Entity {canonical_name: $canonical_name, "
                "                 entity_type: $entity_type}) "
                "ON CREATE SET e.entity_id = $entity_id, "
                "              e.name = $name, "
                "              e.description = $description, "
                "              e.aliases = $aliases "
                "ON MATCH SET  e.description = CASE "
                "                WHEN e.description IS NULL THEN $description "
                "                ELSE e.description END, "
                "              e.aliases = CASE "
                "                WHEN size($aliases) > size(coalesce(e.aliases, [])) "
                "                THEN $aliases ELSE e.aliases END",
                canonical_name=canonical,
                entity_type=entity_type,
                entity_id=entity_id,
                name=canonical,
                description=description,
                aliases=aliases,
            )
            counts["entities"] += 1

            # SOURCED_FROM edge
            await tx.run(
                "MATCH (e:Entity {canonical_name: $canonical_name, "
                "                 entity_type: $entity_type}) "
                "MATCH (r:Report {report_id: $report_id}) "
                "MERGE (e)-[:SOURCED_FROM]->(r)",
                canonical_name=canonical,
                entity_type=entity_type,
                report_id=report_id,
            )
            counts["edges"] += 1

        # Also ensure resolved entities not in the raw list are present
        for resolved in extractions.resolved_entities:
            canon_lower = resolved.canonical_name.lower()
            if canon_lower in entity_node_map:
                continue
            entity_id = str(uuid4())
            entity_node_map[canon_lower] = entity_id
            await tx.run(
                "MERGE (e:Entity {canonical_name: $canonical_name, "
                "                 entity_type: $entity_type}) "
                "ON CREATE SET e.entity_id = $entity_id, "
                "              e.name = $name, "
                "              e.description = $description, "
                "              e.aliases = $aliases",
                canonical_name=resolved.canonical_name,
                entity_type=resolved.type.value,
                entity_id=entity_id,
                name=resolved.canonical_name,
                description=resolved.description,
                aliases=resolved.aliases,
            )
            counts["entities"] += 1

        # --- Metrics & MetricValues ---------------------------------------
        metric_name_map: dict[str, str] = {}  # metric name lower -> metric_id

        for metric in extractions.metrics:
            metric_lower = metric.name.lower()

            # MERGE the Metric concept node
            if metric_lower not in metric_name_map:
                metric_id = str(uuid4())
                metric_name_map[metric_lower] = metric_id
                await tx.run(
                    "MERGE (m:Metric {name: $name}) "
                    "ON CREATE SET m.metric_id = $metric_id, "
                    "              m.unit = $unit",
                    name=metric.name,
                    metric_id=metric_id,
                    unit=metric.unit,
                )
                counts["metrics"] += 1

            # CREATE the MetricValue node
            value_id = str(uuid4())
            await tx.run(
                "CREATE (mv:MetricValue {"
                "  value_id: $value_id, "
                "  value: $value, "
                "  unit: $unit, "
                "  period: $period"
                "})",
                value_id=value_id,
                value=metric.value,
                unit=metric.unit,
                period=metric.period,
            )
            counts["metric_values"] += 1

            # MEASURES edge: MetricValue -> Metric
            await tx.run(
                "MATCH (mv:MetricValue {value_id: $value_id}) "
                "MATCH (m:Metric {name: $metric_name}) "
                "MERGE (mv)-[:MEASURES]->(m)",
                value_id=value_id,
                metric_name=metric.name,
            )
            counts["edges"] += 1

            # HAS_VALUE edge: Entity -> MetricValue (if entity_name set)
            if metric.entity_name:
                resolved = resolved_map.get(metric.entity_name.lower())
                canonical = resolved.canonical_name if resolved else metric.entity_name
                entity_type = resolved.type.value if resolved else "OTHER"
                await tx.run(
                    "MATCH (e:Entity {canonical_name: $canonical_name, "
                    "                 entity_type: $entity_type}) "
                    "MATCH (mv:MetricValue {value_id: $value_id}) "
                    "MERGE (e)-[:HAS_VALUE]->(mv)",
                    canonical_name=canonical,
                    entity_type=entity_type,
                    value_id=value_id,
                )
                counts["edges"] += 1

            # SUPPORTED_BY edge: MetricValue -> SourceSpan
            if metric.source_block_id and metric.source_block_id in block_id_map:
                para_id = block_id_map[metric.source_block_id]
                await tx.run(
                    "MATCH (mv:MetricValue {value_id: $value_id}) "
                    "MATCH (p:Paragraph {paragraph_id: $para_id}) "
                    "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) "
                    "MERGE (mv)-[:SUPPORTED_BY]->(sp)",
                    value_id=value_id,
                    para_id=para_id,
                )
                counts["edges"] += 1

        # --- Claims -------------------------------------------------------
        for claim in extractions.claims:
            claim_id = str(uuid4())
            await tx.run(
                "CREATE (c:Claim {"
                "  claim_id: $claim_id, "
                "  text: $text, "
                "  claim_type: $claim_type, "
                "  confidence: $confidence"
                "})",
                claim_id=claim_id,
                text=claim.text,
                claim_type=claim.type.value,
                confidence=claim.confidence,
            )
            counts["claims"] += 1

            # ASSERTS edge: Paragraph -> Claim
            if claim.source_block_id and claim.source_block_id in block_id_map:
                para_id = block_id_map[claim.source_block_id]
                await tx.run(
                    "MATCH (p:Paragraph {paragraph_id: $para_id}) "
                    "MATCH (c:Claim {claim_id: $claim_id}) "
                    "MERGE (p)-[:ASSERTS]->(c)",
                    para_id=para_id,
                    claim_id=claim_id,
                )
                counts["edges"] += 1

                # SUPPORTED_BY edge: Claim -> SourceSpan
                await tx.run(
                    "MATCH (c:Claim {claim_id: $claim_id}) "
                    "MATCH (p:Paragraph {paragraph_id: $para_id}) "
                    "MATCH (p)-[:HAS_SPAN]->(sp:SourceSpan) "
                    "MERGE (c)-[:SUPPORTED_BY]->(sp)",
                    claim_id=claim_id,
                    para_id=para_id,
                )
                counts["edges"] += 1

            # ABOUT / MENTIONS edges: Claim -> Entity
            for entity_name in claim.entities_mentioned:
                resolved = resolved_map.get(entity_name.lower())
                canonical = resolved.canonical_name if resolved else entity_name
                entity_type = resolved.type.value if resolved else "OTHER"

                # First mentioned entity gets ABOUT, rest get MENTIONS
                edge_type = "ABOUT" if entity_name == claim.entities_mentioned[0] else "MENTIONS"
                await tx.run(
                    f"MATCH (c:Claim {{claim_id: $claim_id}}) "
                    f"MATCH (e:Entity {{canonical_name: $canonical_name, "
                    f"                  entity_type: $entity_type}}) "
                    f"MERGE (c)-[:{edge_type}]->(e)",
                    claim_id=claim_id,
                    canonical_name=canonical,
                    entity_type=entity_type,
                )
                counts["edges"] += 1

        # --- Relationships ---------------------------------------------------
        for rel in extractions.relationships:
            rel_type = rel.relationship_type.strip().upper()
            if rel_type not in _VALID_RELATIONSHIP_TYPES:
                logger.warning(
                    "Skipping unknown relationship type %r for %s -> %s",
                    rel_type,
                    rel.source_entity,
                    rel.target_entity,
                )
                continue

            # Resolve source and target entity names through the resolved map.
            source_resolved = resolved_map.get(rel.source_entity.lower())
            source_canonical = (
                source_resolved.canonical_name if source_resolved else rel.source_entity
            )
            target_resolved = resolved_map.get(rel.target_entity.lower())
            target_canonical = (
                target_resolved.canonical_name if target_resolved else rel.target_entity
            )

            # Use string formatting for the relationship type label.  This is
            # safe because rel_type has been validated against the fixed
            # _VALID_RELATIONSHIP_TYPES set above.
            await tx.run(
                f"MATCH (source:Entity) "
                f"WHERE source.canonical_name = $source_name "
                f"   OR source.name = $source_name "
                f"MATCH (target:Entity) "
                f"WHERE target.canonical_name = $target_name "
                f"   OR target.name = $target_name "
                f"MERGE (source)-[r:{rel_type}]->(target) "
                f"SET r.description = $description, "
                f"    r.confidence = $confidence, "
                f"    r.source_text = $source_text",
                source_name=source_canonical,
                target_name=target_canonical,
                description=rel.description,
                confidence=rel.confidence,
                source_text=rel.source_text,
            )
            counts["relationships"] += 1
            counts["edges"] += 1

        logger.info(
            "Document %s written: %s",
            report_id,
            ", ".join(f"{k}={v}" for k, v in counts.items()),
        )
        return counts
