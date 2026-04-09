from __future__ import annotations

import asyncio
import logging

from insightgraph_core.ir.extraction import (
    ExtractedClaim,
    ExtractedEntity,
    ExtractedMetric,
    ExtractionResult,
)
from insightgraph_core.ir.models import Block, DocumentIR
from insightgraph_core.types import BlockType
from insightgraph_extractor.claim import ClaimExtractor
from insightgraph_extractor.entity import EntityExtractor
from insightgraph_extractor.metric import MetricExtractor

logger = logging.getLogger(__name__)

# Block types that contain natural-language text suitable for entity / claim
# extraction.
_TEXT_BLOCK_TYPES = {BlockType.PARAGRAPH, BlockType.HEADING}


class ExtractionPipeline:
    """Orchestrates entity, metric, and claim extraction over a DocumentIR.

    All three extractors run concurrently via ``asyncio.gather``.
    """

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_key: str = "",
    ) -> None:
        self.entity_extractor = EntityExtractor(model=model, api_key=api_key)
        self.metric_extractor = MetricExtractor(model=model, api_key=api_key)
        self.claim_extractor = ClaimExtractor(model=model, api_key=api_key)

    async def extract(self, doc: DocumentIR) -> ExtractionResult:
        """Run the full extraction pipeline on a parsed document.

        Args:
            doc: The intermediate representation of the parsed document.

        Returns:
            An ``ExtractionResult`` containing all extracted entities, metrics,
            and claims.
        """
        all_blocks: list[Block] = list(doc.iter_all_blocks())
        text_blocks: list[Block] = [b for b in all_blocks if b.type in _TEXT_BLOCK_TYPES]

        context = {"title": doc.title or doc.source_filename}

        logger.info(
            "Starting extraction pipeline for document %s (%d total blocks, %d text blocks)",
            doc.id,
            len(all_blocks),
            len(text_blocks),
        )

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

        logger.info(
            "Extraction complete for document %s: %d entities, %d metrics, %d claims",
            doc.id,
            len(entities),
            len(metrics),
            len(claims),
        )

        return ExtractionResult(
            document_id=doc.id,
            entities=entities,
            metrics=metrics,
            claims=claims,
        )
