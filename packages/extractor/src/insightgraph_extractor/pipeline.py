from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from insightgraph_core.ir.extraction import (
    ExtractedClaim,
    ExtractedEntity,
    ExtractedMetric,
    ExtractedRelationship,
    ExtractionResult,
)
from insightgraph_core.ir.models import Block, DocumentIR
from insightgraph_core.types import BlockType
from insightgraph_extractor.claim import ClaimExtractor
from insightgraph_extractor.entity import EntityExtractor
from insightgraph_extractor.metric import MetricExtractor
from insightgraph_extractor.relationship import RelationshipExtractor

if TYPE_CHECKING:
    from insightgraph_core.domain import DomainConfig

logger = logging.getLogger(__name__)

_TEXT_BLOCK_TYPES = {BlockType.PARAGRAPH, BlockType.HEADING}
_DATA_BLOCK_TYPES = {BlockType.PARAGRAPH, BlockType.HEADING, BlockType.DATA_ROW}


class ExtractionPipeline:
    """Orchestrates entity, metric, claim, and relationship extraction.

    Supports domain-specific configuration for custom entity types,
    relationship types, and extraction instructions.
    """

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_key: str = "",
        domain_config: DomainConfig | None = None,
    ) -> None:
        self.entity_extractor = EntityExtractor(model=model, api_key=api_key)
        self.metric_extractor = MetricExtractor(model=model, api_key=api_key)
        self.claim_extractor = ClaimExtractor(model=model, api_key=api_key)
        self.relationship_extractor = RelationshipExtractor(model=model, api_key=api_key)
        self._domain = domain_config

    async def extract(self, doc: DocumentIR) -> ExtractionResult:
        """Run the full extraction pipeline on a parsed document."""
        all_blocks: list[Block] = list(doc.iter_all_blocks())
        text_blocks: list[Block] = [b for b in all_blocks if b.type in _DATA_BLOCK_TYPES]

        # Build context with domain-specific instructions
        context: dict = {"title": doc.title or doc.source_filename}
        if self._domain:
            context["domain"] = self._domain.name
            context["entity_types"] = self._domain.entity_types
            context["relationship_types"] = self._domain.relationship_types
            if self._domain.extraction_instructions:
                context["instructions"] = self._domain.extraction_instructions
            if self._domain.example_entities:
                context["example_entities"] = self._domain.example_entities
            if self._domain.example_relationships:
                context["example_relationships"] = self._domain.example_relationships

        logger.info(
            "Extraction pipeline for %s (%d blocks, domain=%s)",
            doc.id,
            len(all_blocks),
            self._domain.name if self._domain else "default",
        )

        # Step 1: Extract entities, metrics, and claims concurrently
        results = await asyncio.gather(
            self.entity_extractor.extract(text_blocks, context),
            self.metric_extractor.extract(all_blocks, context),
            self.claim_extractor.extract(text_blocks, context),
            return_exceptions=True,
        )

        entities: list[ExtractedEntity] = []
        metrics: list[ExtractedMetric] = []
        claims: list[ExtractedClaim] = []

        for idx, result in enumerate(results):
            if isinstance(result, BaseException):
                extractor_name = ("entity", "metric", "claim")[idx]
                logger.error("%s extractor failed: %s", extractor_name, result)
                continue
            if idx == 0:
                entities = result
            elif idx == 1:
                metrics = result
            else:
                claims = result

        # Step 2: Extract relationships using entity names as context
        relationships: list[ExtractedRelationship] = []
        if entities:
            entity_names = list({e.name for e in entities})
            rel_context = {**context, "entities": entity_names}
            try:
                relationships = await self.relationship_extractor.extract(text_blocks, rel_context)
            except Exception as exc:
                logger.error("Relationship extractor failed: %s", exc)

        logger.info(
            "Extraction complete: %d entities, %d metrics, %d claims, %d relationships",
            len(entities),
            len(metrics),
            len(claims),
            len(relationships),
        )

        return ExtractionResult(
            document_id=doc.id,
            entities=entities,
            metrics=metrics,
            claims=claims,
            relationships=relationships,
        )
