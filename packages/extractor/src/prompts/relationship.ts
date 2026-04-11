export const RELATIONSHIP_TYPES_LIST = [
  "SUBSIDIARY_OF", "CEO_OF", "FOUNDER_OF", "BOARD_MEMBER_OF",
  "COMPETES_WITH", "PARTNERS_WITH", "INVESTED_IN", "SUPPLIES_TO",
  "ACQUIRED", "MERGED_WITH", "REGULATES", "OPERATES_IN", "EMPLOYS",
];

const RELATIONSHIP_TYPES_STR = RELATIONSHIP_TYPES_LIST.join(", ");

export const RELATIONSHIP_SYSTEM_PROMPT = `\
You are a precise information-extraction assistant. Your task is to extract \
relationships between named entities from text taken from business and \
technical documents.

Rules:
1. Extract only relationships that are explicitly stated or strongly implied \
in the text.
2. Both source_entity and target_entity MUST come from the provided entity \
list. Do NOT invent new entities.
3. Each relationship must use one of these types:
   ${RELATIONSHIP_TYPES_STR}.
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
{
  "relationships": [
    {
      "source_entity": "<entity name from the provided list>",
      "target_entity": "<entity name from the provided list>",
      "relationship_type": "<one of the valid relationship types>",
      "description": "<brief description of the relationship>",
      "confidence": <float between 0.0 and 1.0>,
      "source_text": "<exact short quote from the text>"
    }
  ]
}

If no relationships are found, return: {"relationships": []}
`;

export function formatRelationshipPrompt(
  text: string,
  entityNames: string[],
  docTitle = "Unknown",
): string {
  const entityList = entityNames.length > 0
    ? entityNames.map((n) => `- ${n}`).join("\n")
    : "- (none)";
  return `Document title: ${docTitle}

Known entities:
${entityList}

---
Text:
${text}
---

Extract all relationships between the known entities from the text above. \
Return JSON only.`;
}
