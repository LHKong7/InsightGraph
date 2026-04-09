from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

import litellm

from insightgraph_core.ir.extraction import ExtractedClaim
from insightgraph_core.ir.models import Block
from insightgraph_core.types import ClaimType
from insightgraph_extractor.base import BaseExtractor
from insightgraph_extractor.prompts.claim import (
    CLAIM_SYSTEM_PROMPT,
    format_claim_prompt,
)

logger = logging.getLogger(__name__)

_BATCH_SIZE = 5
_MAX_CONCURRENCY = 4

# Valid claim type values for fast lookup.
_VALID_CLAIM_TYPES = {c.value for c in ClaimType}


def _parse_claim_type(raw: str) -> ClaimType:
    """Safely parse a claim type string, defaulting to FACTUAL."""
    normalized = raw.strip().upper()
    if normalized in _VALID_CLAIM_TYPES:
        return ClaimType(normalized)
    return ClaimType.FACTUAL


def _parse_claims(raw_json: str, block_ids: list[UUID]) -> list[ExtractedClaim]:
    """Parse LLM JSON response into ExtractedClaim objects."""
    try:
        data: dict[str, Any] = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse claim extraction JSON: %s", raw_json[:200])
        return []

    claims_raw = data.get("claims")
    if not isinstance(claims_raw, list):
        logger.warning("Expected 'claims' list in response, got %s", type(claims_raw))
        return []

    default_block_id = block_ids[0] if block_ids else None
    results: list[ExtractedClaim] = []

    for item in claims_raw:
        if not isinstance(item, dict):
            continue

        text = (item.get("text") or "").strip()
        if not text:
            continue

        if default_block_id is None:
            continue

        claim_type = _parse_claim_type(item.get("type", "FACTUAL"))

        entities_mentioned_raw = item.get("entities_mentioned", [])
        if not isinstance(entities_mentioned_raw, list):
            entities_mentioned_raw = []
        entities_mentioned = [
            str(e).strip() for e in entities_mentioned_raw if isinstance(e, str) and str(e).strip()
        ]

        source_text = (item.get("source_text") or "").strip()

        results.append(
            ExtractedClaim(
                text=text,
                type=claim_type,
                entities_mentioned=entities_mentioned,
                source_block_id=default_block_id,
                source_text=source_text,
            )
        )

    return results


class ClaimExtractor(BaseExtractor):
    """Extracts claims and assertions from document blocks using an LLM."""

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
    ) -> list[ExtractedClaim]:
        """Extract claims from *blocks*."""
        if not blocks:
            return []

        ctx = context or {}
        doc_title = ctx.get("title") or "Unknown"

        batches = self._make_batches(blocks)
        tasks = [self._extract_batch(batch, doc_title=doc_title) for batch in batches]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        all_claims: list[ExtractedClaim] = []
        for result in batch_results:
            if isinstance(result, BaseException):
                logger.error("Claim extraction batch failed: %s", result)
                continue
            all_claims.extend(result)

        return all_claims

    # -- internals ------------------------------------------------------------

    def _make_batches(self, blocks: list[Block]) -> list[list[Block]]:
        return [blocks[i : i + self.batch_size] for i in range(0, len(blocks), self.batch_size)]

    async def _extract_batch(self, batch: list[Block], doc_title: str) -> list[ExtractedClaim]:
        combined_text = "\n\n".join(block.content for block in batch)
        block_ids = [block.id for block in batch]

        section_title = "Unknown"
        for block in batch:
            if block.level is not None:
                section_title = block.content
                break

        user_prompt = format_claim_prompt(
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
                        {"role": "system", "content": CLAIM_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                )
            except Exception:
                logger.exception("LLM call failed for claim extraction batch")
                return []

        raw_content = response.choices[0].message.content or ""
        claims = _parse_claims(raw_content, block_ids)

        # Match source_text to the correct block.
        claims = self._match_source_blocks(claims, batch)
        return claims

    @staticmethod
    def _match_source_blocks(
        claims: list[ExtractedClaim], blocks: list[Block]
    ) -> list[ExtractedClaim]:
        """Best-effort assignment of each claim's source_block_id."""
        updated: list[ExtractedClaim] = []
        for claim in claims:
            if claim.source_text:
                for block in blocks:
                    if claim.source_text in block.content:
                        claim = claim.model_copy(update={"source_block_id": block.id})
                        break
            updated.append(claim)
        return updated
