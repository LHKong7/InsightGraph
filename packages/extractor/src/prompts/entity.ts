const ENTITY_SYSTEM_PROMPT = `\
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
`;

const ENTITY_USER_TEMPLATE = `\
Document title: {doc_title}
Section title: {section_title}
{domain_instructions}
---
Text:
{text}
---

Extract all named entities from the text above. Return JSON only.`;

const DEFAULT_ENTITY_TYPES = [
  "ORGANIZATION", "PERSON", "LOCATION", "PRODUCT",
  "INDUSTRY", "EVENT", "OTHER",
];

export function formatEntitySystemPrompt(entityTypes?: string[]): string {
  const types = entityTypes ?? DEFAULT_ENTITY_TYPES;
  return ENTITY_SYSTEM_PROMPT.replace("{entity_types}", types.join(", "));
}

export function formatEntityPrompt(
  text: string,
  docTitle = "Unknown",
  sectionTitle = "Unknown",
  domainInstructions = "",
): string {
  const instr = domainInstructions
    ? `\nDomain instructions: ${domainInstructions}\n`
    : "";
  return ENTITY_USER_TEMPLATE
    .replace("{doc_title}", docTitle)
    .replace("{section_title}", sectionTitle)
    .replace("{text}", text)
    .replace("{domain_instructions}", instr);
}
