from __future__ import annotations

ENTITY_SYSTEM_PROMPT = """\
You are a precise information-extraction assistant. Your task is to extract \
named entities from text taken from business and technical documents.

Rules:
1. Extract only entities that are explicitly mentioned in the text.
2. Each entity must belong to exactly one of these types:
   ORGANIZATION, PERSON, LOCATION, PRODUCT, INDUSTRY, EVENT, OTHER.
3. Provide a brief one-sentence description of the entity based on what the \
text says about it.
4. Include the exact source quote that mentions the entity in "source_text". \
Keep quotes short (one sentence maximum).
5. Do NOT invent entities that are not present in the text.
6. Deduplicate: if the same entity appears multiple times, return it only once \
with the best description and source quote.
7. Return valid JSON matching the schema below and nothing else.

Output schema:
{
  "entities": [
    {
      "name": "<canonical entity name>",
      "type": "<ORGANIZATION|PERSON|LOCATION|PRODUCT|INDUSTRY|EVENT|OTHER>",
      "description": "<brief description from context>",
      "source_text": "<exact short quote from the text>"
    }
  ]
}

If no entities are found, return: {"entities": []}
"""

ENTITY_USER_TEMPLATE = """\
Document title: {doc_title}
Section title: {section_title}

---
Text:
{text}
---

Extract all named entities from the text above. Return JSON only.\
"""


def format_entity_prompt(
    text: str,
    doc_title: str = "Unknown",
    section_title: str = "Unknown",
) -> str:
    """Render the entity extraction user prompt with the given context."""
    return ENTITY_USER_TEMPLATE.format(
        doc_title=doc_title,
        section_title=section_title,
        text=text,
    )
