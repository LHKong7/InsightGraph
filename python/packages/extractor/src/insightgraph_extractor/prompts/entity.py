from __future__ import annotations

ENTITY_SYSTEM_PROMPT = """\
You are a precise information-extraction assistant. Your task is to extract \
named entities from text.

Rules:
1. Extract only entities that are explicitly mentioned in the text.
2. Each entity must belong to one of the entity types listed below.
3. Provide a brief one-sentence description of the entity based on what the \
text says about it.
4. Include the exact source quote that mentions the entity in "source_text". \
Keep quotes short (one sentence maximum).
5. Do NOT invent entities that are not present in the text.
6. Deduplicate: if the same entity appears multiple times, return it only once \
with the best description and source quote.
7. Return valid JSON matching the schema below and nothing else.

Entity types: {entity_types}

Output schema:
{{
  "entities": [
    {{
      "name": "<canonical entity name>",
      "type": "<one of the entity types above>",
      "description": "<brief description from context>",
      "source_text": "<exact short quote from the text>"
    }}
  ]
}}

If no entities are found, return: {{"entities": []}}
"""

ENTITY_USER_TEMPLATE = """\
Document title: {doc_title}
Section title: {section_title}
{domain_instructions}
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
    domain_instructions: str = "",
) -> str:
    """Render the entity extraction user prompt with the given context."""
    instr = ""
    if domain_instructions:
        instr = f"\nDomain instructions: {domain_instructions}\n"
    return ENTITY_USER_TEMPLATE.format(
        doc_title=doc_title,
        section_title=section_title,
        text=text,
        domain_instructions=instr,
    )


def format_entity_system_prompt(
    entity_types: list[str] | None = None,
) -> str:
    """Render the entity extraction system prompt with custom entity types."""
    types = entity_types or [
        "ORGANIZATION",
        "PERSON",
        "LOCATION",
        "PRODUCT",
        "INDUSTRY",
        "EVENT",
        "OTHER",
    ]
    return ENTITY_SYSTEM_PROMPT.format(entity_types=", ".join(types))
