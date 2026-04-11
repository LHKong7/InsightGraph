from __future__ import annotations

RELATIONSHIP_TYPES_LIST = [
    "SUBSIDIARY_OF",
    "CEO_OF",
    "FOUNDER_OF",
    "BOARD_MEMBER_OF",
    "COMPETES_WITH",
    "PARTNERS_WITH",
    "INVESTED_IN",
    "SUPPLIES_TO",
    "ACQUIRED",
    "MERGED_WITH",
    "REGULATES",
    "OPERATES_IN",
    "EMPLOYS",
]

_RELATIONSHIP_TYPES_STR = ", ".join(RELATIONSHIP_TYPES_LIST)

RELATIONSHIP_SYSTEM_PROMPT = f"""\
You are a precise information-extraction assistant. Your task is to extract \
relationships between named entities from text taken from business and \
technical documents.

Rules:
1. Extract only relationships that are explicitly stated or strongly implied \
in the text.
2. Both source_entity and target_entity MUST come from the provided entity \
list. Do NOT invent new entities.
3. Each relationship must use one of these types:
   {_RELATIONSHIP_TYPES_STR}.
4. Provide a brief one-sentence description of the relationship based on \
what the text says.
5. Include a confidence score between 0.0 and 1.0 indicating how clearly \
the relationship is stated in the text.
6. Include the exact short source quote from the text that supports the \
relationship in "source_text". Keep quotes short (one sentence maximum).
7. Do NOT invent relationships that are not supported by the text.
8. If an entity appears in a relationship but is not in the provided entity \
list, skip that relationship.
9. Return valid JSON matching the schema below and nothing else.

Output schema:
{{
  "relationships": [
    {{
      "source_entity": "<entity name from the provided list>",
      "target_entity": "<entity name from the provided list>",
      "relationship_type": "<one of the valid relationship types>",
      "description": "<brief description of the relationship>",
      "confidence": <float between 0.0 and 1.0>,
      "source_text": "<exact short quote from the text>"
    }}
  ]
}}

If no relationships are found, return: {{"relationships": []}}
"""

RELATIONSHIP_USER_TEMPLATE = """\
Document title: {doc_title}

Known entities:
{entity_list}

---
Text:
{text}
---

Extract all relationships between the known entities from the text above. \
Return JSON only.\
"""


def format_relationship_prompt(
    text: str,
    entity_names: list[str],
    doc_title: str = "Unknown",
) -> str:
    """Render the relationship extraction user prompt with the given context."""
    entity_list = "\n".join(f"- {name}" for name in entity_names) if entity_names else "- (none)"
    return RELATIONSHIP_USER_TEMPLATE.format(
        doc_title=doc_title,
        entity_list=entity_list,
        text=text,
    )
