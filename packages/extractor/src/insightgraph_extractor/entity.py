from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

import litellm

from insightgraph_core.ir.extraction import ExtractedEntity
from insightgraph_core.ir.models import Block
from insightgraph_core.types import EntityType
from insightgraph_extractor.base import BaseExtractor
from insightgraph_extractor.prompts.entity import (
    ENTITY_SYSTEM_PROMPT,
    format_entity_prompt,
)

logger = logging.getLogger(__name__)

_BATCH_SIZE = 5
_MAX_CONCURRENCY = 4

# Valid entity type values for fast lookup.
_VALID_ENTITY_TYPES = {e.value for e in EntityType}


def _parse_entity_type(raw: str) -> EntityType | None:
    """Safely parse an entity type string, returning None if invalid."""
    normalized = raw.strip().upper()
    if normalized in _VALID_ENTITY_TYPES:
        return EntityType(normalized)
    return None


def _parse_entities(raw_json: str, block_ids: list[UUID]) -> list[ExtractedEntity]:
    """Parse LLM JSON response into ExtractedEntity objects.

    Each extracted entity is linked to the first block id in the batch as a
    default.  A smarter approach would match source_text to the originating
    block, but for now we keep it simple.
    """
    try:
        data: dict[str, Any] = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse entity extraction JSON: %s", raw_json[:200])
        return []

    entities_raw = data.get("entities")
    if not isinstance(entities_raw, list):
        logger.warning("Expected 'entities' list in response, got %s", type(entities_raw))
        return []

    results: list[ExtractedEntity] = []
    for item in entities_raw:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        if not name:
            continue

        entity_type = _parse_entity_type(item.get("type", "OTHER"))
        if entity_type is None:
            entity_type = EntityType.OTHER

        # Attempt to match source_text to a specific block.
        source_text = (item.get("source_text") or "").strip()
        matched_block_id = block_ids[0] if block_ids else None
        for bid, block_id in enumerate(block_ids):
            # We don't have block content here; use first block as fallback.
            _ = bid  # placeholder for potential future matching
            matched_block_id = block_id
            break

        if matched_block_id is None:
            continue

        results.append(
            ExtractedEntity(
                name=name,
                type=entity_type,
                description=(item.get("description") or "").strip() or None,
                source_block_id=matched_block_id,
                source_text=source_text,
            )
        )

    return results


class EntityExtractor(BaseExtractor):
    """Extracts named entities from document blocks using an LLM."""

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
    ) -> list[ExtractedEntity]:
        """Extract entities from *blocks*, returning deduplicated results."""
        if not blocks:
            return []

        ctx = context or {}
        doc_title = ctx.get("title") or "Unknown"

        batches = self._make_batches(blocks)
        tasks = [self._extract_batch(batch, doc_title=doc_title) for batch in batches]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        all_entities: list[ExtractedEntity] = []
        for result in batch_results:
            if isinstance(result, BaseException):
                logger.error("Entity extraction batch failed: %s", result)
                continue
            all_entities.extend(result)

        return self._deduplicate(all_entities)

    # -- internals ------------------------------------------------------------

    def _make_batches(self, blocks: list[Block]) -> list[list[Block]]:
        """Split blocks into batches of at most *batch_size*."""
        return [blocks[i : i + self.batch_size] for i in range(0, len(blocks), self.batch_size)]

    async def _extract_batch(self, batch: list[Block], doc_title: str) -> list[ExtractedEntity]:
        """Call the LLM for a single batch of blocks."""
        combined_text = "\n\n".join(block.content for block in batch)
        block_ids = [block.id for block in batch]

        # Derive a section title from the first heading block, if any.
        section_title = "Unknown"
        for block in batch:
            if block.level is not None:
                section_title = block.content
                break

        user_prompt = format_entity_prompt(
            text=combined_text,
            doc_title=doc_title,
            section_title=section_title,
        )

        async with self._semaphore:
            try:
                response = await litellm.acompletion(
                    model=self.model,
                    api_key=self.api_key or None,
                    messages=[
                        {"role": "system", "content": ENTITY_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                )
            except Exception:
                logger.exception("LLM call failed for entity extraction batch")
                return []

        raw_content = response.choices[0].message.content or ""
        entities = _parse_entities(raw_content, block_ids)

        # Retroactively match source_text to the correct block id.
        entities = self._match_source_blocks(entities, batch)
        return entities

    @staticmethod
    def _match_source_blocks(
        entities: list[ExtractedEntity], blocks: list[Block]
    ) -> list[ExtractedEntity]:
        """Best-effort assignment of each entity's source_block_id to the
        block whose content contains the source_text."""
        updated: list[ExtractedEntity] = []
        for entity in entities:
            if entity.source_text:
                for block in blocks:
                    if entity.source_text in block.content:
                        entity = entity.model_copy(update={"source_block_id": block.id})
                        break
            updated.append(entity)
        return updated

    @staticmethod
    def _deduplicate(entities: list[ExtractedEntity]) -> list[ExtractedEntity]:
        """Deduplicate by canonical name (case-insensitive), keeping the first
        occurrence."""
        seen: dict[str, ExtractedEntity] = {}
        for entity in entities:
            key = entity.name.lower()
            if key not in seen:
                seen[key] = entity
        return list(seen.values())
