from __future__ import annotations

import json
import logging

import litellm

logger = logging.getLogger(__name__)

ANALYST_SYSTEM_PROMPT = """You are an analyst for InsightGraph. Given retrieved data from a knowledge graph, synthesize a clear, evidence-backed answer.

Rules:
1. Only make claims supported by the retrieved data.
2. Cite evidence using page numbers and source spans when available.
3. If the data is insufficient, say so clearly.
4. Structure your response with clear sections if the answer is complex.
5. Include specific numbers, dates, and entity names from the data.

Respond in JSON:
{
  "answer": "The synthesized answer with citations",
  "key_findings": ["finding 1", "finding 2"],
  "evidence_used": [
    {"text": "source quote", "page": 5, "claim_id": "..."}
  ],
  "confidence": 0.85,
  "gaps": ["any information gaps noted"]
}
"""


class Analyst:
    """Synthesizes retrieved data into structured analysis with citations."""

    def __init__(self, model: str = "gpt-4o-mini", api_key: str = ""):
        self.model = model
        self.api_key = api_key

    async def analyze(self, question: str, retrieval_results: list[dict]) -> dict:
        """Synthesize retrieval results into an evidence-backed answer."""
        context = self._format_context(retrieval_results)

        kwargs: dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": ANALYST_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Question: {question}\n\nRetrieved Data:\n{context}",
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key

        try:
            response = await litellm.acompletion(**kwargs)
            content = response.choices[0].message.content
            return json.loads(content)
        except Exception:
            logger.warning("Analyst failed", exc_info=True)
            return {
                "answer": "Unable to generate analysis from the available data.",
                "key_findings": [],
                "evidence_used": [],
                "confidence": 0.0,
                "gaps": ["Analysis generation failed"],
            }

    @staticmethod
    def _format_context(results: list[dict]) -> str:
        """Format retrieval results into a readable context string."""
        parts = []
        for i, r in enumerate(results, 1):
            tool = r.get("tool", "unknown")
            result = r.get("result")
            error = r.get("error")
            if error:
                parts.append(f"[Step {i}] {tool}: ERROR - {error}")
            elif result:
                parts.append(f"[Step {i}] {tool}:\n{json.dumps(result, indent=2, default=str)}")
            else:
                parts.append(f"[Step {i}] {tool}: No results")
        return "\n\n".join(parts)
