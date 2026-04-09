from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

import litellm

from insightgraph_core.ir.extraction import ExtractedRelationship
from insightgraph_core.ir.models import Block
from insightgraph_extractor.base import BaseExtractor
from insightgraph_extractor.prompts.relationship import (
    RELATIONSHIP_SYSTEM_PROMPT,
    format_relationship_prompt,
)

logger = logging.getLogger(__name__)

_BATCH_SIZE = 5
_MAX_CONCURRENCY = 4
_REL_TYPE_PATTERN = __import__("re").compile(r"^[A-Z][A-Z0-9_]*$")


def _parse_relationships(
    raw_json: str,
    block_ids: list[UUID],
    entity_names_lower: set[str],
) -> list[ExtractedRelationship]:
    """Parse LLM JSON response into ExtractedRelationship objects.

    Only relationships whose source and target entities appear in
    *entity_names_lower* (lowercased) are kept.
    """
    try:
        data: dict[str, Any] = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse relationship extraction JSON: %s", raw_json[:200])
        return []

    relationships_raw = data.get("relationships")
    if not isinstance(relationships_raw, list):
        logger.warning(
            "Expected 'relationships' list in response, got %s",
            type(relationships_raw),
        )
        return []

    default_block_id = block_ids[0] if block_ids else None
    if default_block_id is None:
        return []

    results: list[ExtractedRelationship] = []
    for item in relationships_raw:
        if not isinstance(item, dict):
            continue

        source_entity = (item.get("source_entity") or "").strip()
        target_entity = (item.get("target_entity") or "").strip()
        if not source_entity or not target_entity:
            continue

        # Validate both entities exist in the known entity list.
        if (
            source_entity.lower() not in entity_names_lower
            or target_entity.lower() not in entity_names_lower
        ):
            logger.debug(
                "Skipping relationship with unknown entity: %s -> %s",
                source_entity,
                target_entity,
            )
            continue

        # Skip self-relationships.
        if source_entity.lower() == target_entity.lower():
            continue

        relationship_type = (item.get("relationship_type") or "").strip().upper().replace(" ", "_")
        if not _REL_TYPE_PATTERN.match(relationship_type):
            logger.debug(
                "Skipping relationship with invalid type format: %s",
                relationship_type,
            )
            continue

        description = (item.get("description") or "").strip()
        if not description:
            continue

        confidence = item.get("confidence", 0.8)
        if not isinstance(confidence, (int, float)):
            confidence = 0.8
        confidence = max(0.0, min(1.0, float(confidence)))

        source_text = (item.get("source_text") or "").strip()

        results.append(
            ExtractedRelationship(
                source_entity=source_entity,
                target_entity=target_entity,
                relationship_type=relationship_type,
                description=description,
                confidence=confidence,
                source_block_id=default_block_id,
                source_text=source_text,
            )
        )

    return results


class RelationshipExtractor(BaseExtractor):
    """Extracts relationships between entities from document blocks using an LLM."""

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_key: str = "",
        batch_size: int = _BATCH_SIZE,
        max_concurrency: int = _MAX_CONCURRENCY,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.batch_size = batch_size
        self._semaphore = asyncio.Semaphore(max_concurrency)

    # -- public API -----------------------------------------------------------

    async def extract(
        self, blocks: list[Block], context: dict | None = None
    ) -> list[ExtractedRelationship]:
        """Extract relationships from *blocks*, returning deduplicated results.

        *context* should include an ``"entities"`` key with a list of entity
        names already extracted from the document.
        """
        if not blocks:
            return []

        ctx = context or {}
        doc_title = ctx.get("title") or "Unknown"
        entity_names: list[str] = ctx.get("entities") or []

        if not entity_names:
            logger.info("No entity names provided; skipping relationship extraction")
            return []

        entity_names_lower = {name.lower() for name in entity_names}

        batches = self._make_batches(blocks)
        tasks = [
            self._extract_batch(
                batch,
                doc_title=doc_title,
                entity_names=entity_names,
                entity_names_lower=entity_names_lower,
            )
            for batch in batches
        ]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        all_relationships: list[ExtractedRelationship] = []
        for result in batch_results:
            if isinstance(result, BaseException):
                logger.error("Relationship extraction batch failed: %s", result)
                continue
            all_relationships.extend(result)

        return self._deduplicate(all_relationships)

    # -- internals ------------------------------------------------------------

    def _make_batches(self, blocks: list[Block]) -> list[list[Block]]:
        """Split blocks into batches of at most *batch_size*."""
        return [blocks[i : i + self.batch_size] for i in range(0, len(blocks), self.batch_size)]

    async def _extract_batch(
        self,
        batch: list[Block],
        doc_title: str,
        entity_names: list[str],
        entity_names_lower: set[str],
    ) -> list[ExtractedRelationship]:
        """Call the LLM for a single batch of blocks."""
        combined_text = "\n\n".join(block.content for block in batch)
        block_ids = [block.id for block in batch]

        user_prompt = format_relationship_prompt(
            text=combined_text,
            entity_names=entity_names,
            doc_title=doc_title,
        )

        async with self._semaphore:
            try:
                response = await litellm.acompletion(
                    model=self.model,
                    api_key=self.api_key or None,
                    messages=[
                        {"role": "system", "content": RELATIONSHIP_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                )
            except Exception:
                logger.exception("LLM call failed for relationship extraction batch")
                return []

        raw_content = response.choices[0].message.content or ""
        relationships = _parse_relationships(raw_content, block_ids, entity_names_lower)

        # Match source_text to the correct block id.
        relationships = self._match_source_blocks(relationships, batch)
        return relationships

    @staticmethod
    def _match_source_blocks(
        relationships: list[ExtractedRelationship],
        blocks: list[Block],
    ) -> list[ExtractedRelationship]:
        """Best-effort assignment of each relationship's source_block_id to the
        block whose content contains the source_text."""
        updated: list[ExtractedRelationship] = []
        for rel in relationships:
            if rel.source_text:
                for block in blocks:
                    if rel.source_text in block.content:
                        rel = rel.model_copy(update={"source_block_id": block.id})
                        break
            updated.append(rel)
        return updated

    @staticmethod
    def _deduplicate(
        relationships: list[ExtractedRelationship],
    ) -> list[ExtractedRelationship]:
        """Deduplicate by (source, target, type) triple, keeping the first
        occurrence."""
        seen: set[tuple[str, str, str]] = set()
        unique: list[ExtractedRelationship] = []
        for rel in relationships:
            key = (
                rel.source_entity.lower(),
                rel.target_entity.lower(),
                rel.relationship_type,
            )
            if key not in seen:
                seen.add(key)
                unique.append(rel)
        return unique
