from __future__ import annotations

import json
import logging

import litellm

logger = logging.getLogger(__name__)

VERIFIER_SYSTEM_PROMPT = """You are a verification agent for InsightGraph. Your job is to verify an analysis by checking:

1. Every key finding has supporting evidence from the retrieved data.
2. No contradictions exist between findings.
3. The confidence score is appropriate given the evidence.
4. Citations are accurate.

Respond in JSON:
{
  "verified": true,
  "issues": [],
  "adjusted_confidence": 0.85,
  "evidence_coverage": 0.9,
  "notes": "optional notes"
}

If issues are found:
{
  "verified": false,
  "issues": ["Finding X has no supporting evidence", "Contradiction between..."],
  "adjusted_confidence": 0.4,
  "evidence_coverage": 0.5,
  "notes": "..."
}
"""


class Verifier:
    """Checks conclusions for evidence support, contradictions, and confidence."""

    def __init__(self, model: str = "gpt-4o-mini", api_key: str = ""):
        self.model = model
        self.api_key = api_key

    async def verify(self, analysis: dict, retrieval_results: list[dict]) -> dict:
        """Verify an analysis against the retrieved evidence."""
        context = json.dumps(
            {"analysis": analysis, "evidence": retrieval_results},
            indent=2,
            default=str,
        )

        kwargs: dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": VERIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": f"Verify this analysis:\n{context}"},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key

        try:
            response = await litellm.acompletion(**kwargs)
            content = response.choices[0].message.content
            return json.loads(content)
        except Exception:
            logger.warning("Verifier failed", exc_info=True)
            return {
                "verified": False,
                "issues": ["Verification failed due to an error"],
                "adjusted_confidence": 0.0,
                "evidence_coverage": 0.0,
                "notes": "Verification unavailable",
            }
