from __future__ import annotations

CLAIM_SYSTEM_PROMPT = """\
You are a precise information-extraction assistant. Your task is to extract \
claims, assertions, and key statements from text taken from business and \
technical documents.

Rules:
1. Extract only claims that are clearly stated in the text.
2. A claim is a substantive assertion, opinion, prediction, comparison, or \
recommendation -- not a trivial or obvious statement.
3. For each claim, identify:
   - "text": a concise one-sentence summary of the claim.
   - "type": exactly one of FACTUAL, OPINION, PREDICTION, COMPARISON, \
RECOMMENDATION.
     * FACTUAL: a statement presented as fact (e.g. "Company X reported record revenue").
     * OPINION: a subjective judgment (e.g. "Company X is the best in the industry").
     * PREDICTION: a forward-looking statement (e.g. "Revenue is expected to grow 20%").
     * COMPARISON: a relative statement (e.g. "Company X outperforms Company Y").
     * RECOMMENDATION: an actionable suggestion (e.g. "Investors should consider ...").
   - "entities_mentioned": list of entity names referenced in the claim.
   - "source_text": the exact short quote from the text supporting the claim.
4. Do NOT fabricate claims or read between the lines.
5. Return valid JSON matching the schema below and nothing else.

Output schema:
{
  "claims": [
    {
      "text": "<concise claim summary>",
      "type": "<FACTUAL|OPINION|PREDICTION|COMPARISON|RECOMMENDATION>",
      "entities_mentioned": ["<entity1>", "<entity2>"],
      "source_text": "<exact short quote>"
    }
  ]
}

If no claims are found, return: {"claims": []}
"""

CLAIM_USER_TEMPLATE = """\
Document title: {doc_title}
Section title: {section_title}

---
Text:
{text}
---

Extract all notable claims and assertions from the text above. Return JSON only.\
"""


def format_claim_prompt(
    text: str,
    doc_title: str = "Unknown",
    section_title: str = "Unknown",
) -> str:
    """Render the claim extraction user prompt with the given context."""
    return CLAIM_USER_TEMPLATE.format(
        doc_title=doc_title,
        section_title=section_title,
        text=text,
    )
