from __future__ import annotations

import json
import logging
from typing import Any

import litellm

from insightgraph_graph.reader import GraphReader

logger = logging.getLogger(__name__)


class CrossReportAnalyzer:
    """Cross-report analysis: compare entities across reports, find trends and contradictions."""

    def __init__(
        self,
        reader: GraphReader,
        model: str = "gpt-4o-mini",
        api_key: str = "",
    ):
        self._reader = reader
        self._model = model
        self._api_key = api_key

    async def compare_entity_across_reports(self, entity_name: str) -> dict[str, Any]:
        """Compare an entity's claims and metrics across all reports it appears in."""
        return await self._reader.get_cross_report_entity(entity_name)

    async def find_metric_trend(
        self,
        entity_name: str,
        metric_name: str,
    ) -> dict[str, Any]:
        """Find metric values across reports for an entity and detect trend direction."""
        rows = await self._reader.get_metric_history(metric_name, entity_name)

        if not rows:
            # Try without metric_name filter
            rows = await self._reader.get_entity_metrics(entity_name)
            rows = [
                r
                for r in rows
                if metric_name.lower() in r.get("metric", {}).get("name", "").lower()
            ]

        values = []
        for row in rows:
            mv = row.get("metric_value", {})
            values.append(
                {
                    "value": mv.get("value"),
                    "unit": mv.get("unit"),
                    "period": mv.get("period"),
                    "metric_name": row.get("metric", {}).get("name"),
                }
            )

        # Detect trend
        trend = "unknown"
        if len(values) >= 2:
            nums = [v["value"] for v in values if v["value"] is not None]
            if len(nums) >= 2:
                if nums[-1] > nums[0]:
                    trend = "increasing"
                elif nums[-1] < nums[0]:
                    trend = "decreasing"
                else:
                    trend = "stable"

        return {
            "entity_name": entity_name,
            "metric_name": metric_name,
            "values": values,
            "trend": trend,
            "data_points": len(values),
        }

    async def find_contradictions(self, entity_name: str) -> list[dict[str, Any]]:
        """Find claims about an entity that may contradict each other."""
        claims_data = await self._reader.get_claims_about(entity_name)

        if len(claims_data) < 2:
            return []

        claim_texts = [c.get("claim", c).get("text", "") for c in claims_data]

        # Use LLM to detect contradictions
        try:
            return await self._detect_contradictions_llm(entity_name, claim_texts, claims_data)
        except Exception:
            logger.warning("Contradiction detection failed", exc_info=True)
            return []

    async def _detect_contradictions_llm(
        self,
        entity_name: str,
        claim_texts: list[str],
        claims_data: list[dict],
    ) -> list[dict[str, Any]]:
        numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(claim_texts))
        prompt = (
            f"Given these claims about '{entity_name}', identify any contradictions.\n\n"
            f"{numbered}\n\n"
            'Respond in JSON: {"contradictions": [{"claim_a": 1, "claim_b": 3, '
            '"explanation": "why they contradict"}]}'
        )

        kwargs: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": "You detect contradictions between claims."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        if self._api_key:
            kwargs["api_key"] = self._api_key

        response = await litellm.acompletion(**kwargs)
        data = json.loads(response.choices[0].message.content)

        results = []
        for c in data.get("contradictions", []):
            idx_a = c.get("claim_a", 1) - 1
            idx_b = c.get("claim_b", 2) - 1
            if 0 <= idx_a < len(claim_texts) and 0 <= idx_b < len(claim_texts):
                results.append(
                    {
                        "claim_a": claim_texts[idx_a],
                        "claim_b": claim_texts[idx_b],
                        "explanation": c.get("explanation", ""),
                    }
                )
        return results

    async def entity_timeline(self, entity_name: str) -> list[dict[str, Any]]:
        """Build a chronological timeline of claims and metrics for an entity."""
        profile = await self._reader.get_entity_full_profile(entity_name)
        if not profile:
            return []

        timeline = []

        for claim in profile.get("claims", []):
            timeline.append(
                {
                    "type": "claim",
                    "text": claim.get("text"),
                    "claim_type": claim.get("type"),
                    "period": None,
                }
            )

        for metric in profile.get("metrics", []):
            timeline.append(
                {
                    "type": "metric",
                    "text": f"{metric.get('metric_name')}: {metric.get('value')} {metric.get('unit', '')}",
                    "period": metric.get("period"),
                    "value": metric.get("value"),
                    "metric_name": metric.get("metric_name"),
                }
            )

        # Sort by period (metrics with periods first, then claims)
        timeline.sort(key=lambda x: (x.get("period") or "zzz", x.get("type", "")))
        return timeline
