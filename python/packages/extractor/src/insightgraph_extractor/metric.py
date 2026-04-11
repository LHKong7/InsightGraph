from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from uuid import UUID

import litellm

from insightgraph_core.ir.extraction import ExtractedMetric
from insightgraph_core.ir.models import Block
from insightgraph_extractor.base import BaseExtractor
from insightgraph_extractor.prompts.metric import (
    METRIC_SYSTEM_PROMPT,
    format_metric_prompt,
)

logger = logging.getLogger(__name__)

_BATCH_SIZE = 5
_MAX_CONCURRENCY = 4

# Pre-compiled pattern to detect blocks containing numeric content.
_HAS_DIGIT_RE = re.compile(r"\d")


def _block_has_numbers(block: Block) -> bool:
    """Return True if the block's content contains at least one digit."""
    return bool(_HAS_DIGIT_RE.search(block.content))


def _parse_metrics(raw_json: str, block_ids: list[UUID]) -> list[ExtractedMetric]:
    """Parse LLM JSON response into ExtractedMetric objects."""
    try:
        data: dict[str, Any] = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse metric extraction JSON: %s", raw_json[:200])
        return []

    metrics_raw = data.get("metrics")
    if not isinstance(metrics_raw, list):
        logger.warning("Expected 'metrics' list in response, got %s", type(metrics_raw))
        return []

    default_block_id = block_ids[0] if block_ids else None
    results: list[ExtractedMetric] = []

    for item in metrics_raw:
        if not isinstance(item, dict):
            continue

        name = (item.get("name") or "").strip()
        if not name:
            continue

        # Parse value -- must be numeric.
        raw_value = item.get("value")
        if raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (ValueError, TypeError):
            logger.debug("Skipping metric with non-numeric value: %s", raw_value)
            continue

        if default_block_id is None:
            continue

        unit = item.get("unit")
        if isinstance(unit, str):
            unit = unit.strip() or None

        period = item.get("period")
        if isinstance(period, str):
            period = period.strip() or None

        entity_name = item.get("entity_name")
        if isinstance(entity_name, str):
            entity_name = entity_name.strip() or None

        source_text = (item.get("source_text") or "").strip()

        results.append(
            ExtractedMetric(
                name=name,
                value=value,
                unit=unit,
                period=period,
                entity_name=entity_name,
                source_block_id=default_block_id,
                source_text=source_text,
            )
        )

    return results


class MetricExtractor(BaseExtractor):
    """Extracts quantitative metrics from document blocks using an LLM.

    Blocks are pre-filtered to only include those containing numeric content.
    """

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
    ) -> list[ExtractedMetric]:
        """Extract metrics from *blocks*, pre-filtering for numeric content."""
        # Pre-filter: only process blocks that contain at least one digit.
        numeric_blocks = [b for b in blocks if _block_has_numbers(b)]
        if not numeric_blocks:
            return []

        ctx = context or {}
        doc_title = ctx.get("title") or "Unknown"

        batches = self._make_batches(numeric_blocks)
        tasks = [self._extract_batch(batch, doc_title=doc_title) for batch in batches]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        all_metrics: list[ExtractedMetric] = []
        for result in batch_results:
            if isinstance(result, BaseException):
                logger.error("Metric extraction batch failed: %s", result)
                continue
            all_metrics.extend(result)

        return all_metrics

    # -- internals ------------------------------------------------------------

    def _make_batches(self, blocks: list[Block]) -> list[list[Block]]:
        return [blocks[i : i + self.batch_size] for i in range(0, len(blocks), self.batch_size)]

    async def _extract_batch(self, batch: list[Block], doc_title: str) -> list[ExtractedMetric]:
        combined_text = "\n\n".join(block.content for block in batch)
        block_ids = [block.id for block in batch]

        section_title = "Unknown"
        for block in batch:
            if block.level is not None:
                section_title = block.content
                break

        user_prompt = format_metric_prompt(
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
                        {"role": "system", "content": METRIC_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                )
            except Exception:
                logger.exception("LLM call failed for metric extraction batch")
                return []

        raw_content = response.choices[0].message.content or ""
        metrics = _parse_metrics(raw_content, block_ids)

        # Match source_text to the correct block.
        metrics = self._match_source_blocks(metrics, batch)
        return metrics

    @staticmethod
    def _match_source_blocks(
        metrics: list[ExtractedMetric], blocks: list[Block]
    ) -> list[ExtractedMetric]:
        """Best-effort assignment of each metric's source_block_id."""
        updated: list[ExtractedMetric] = []
        for metric in metrics:
            if metric.source_text:
                for block in blocks:
                    if metric.source_text in block.content:
                        metric = metric.model_copy(update={"source_block_id": block.id})
                        break
            updated.append(metric)
        return updated
