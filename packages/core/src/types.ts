// Built-in entity types (extensible via ontology).
// The system treats entity_type as a free-form string, not a closed enum.
export const BUILTIN_ENTITY_TYPES = [
  "ORGANIZATION",
  "PERSON",
  "LOCATION",
  "PRODUCT",
  "INDUSTRY",
  "EVENT",
  "STOCK",
  "DISH",
  "METRIC_INDICATOR",
  "OTHER",
] as const;

export type ClaimType =
  | "FACTUAL"
  | "OPINION"
  | "PREDICTION"
  | "COMPARISON"
  | "RECOMMENDATION"
  | "CAUSAL";

export const CLAIM_TYPES: ClaimType[] = [
  "FACTUAL",
  "OPINION",
  "PREDICTION",
  "COMPARISON",
  "RECOMMENDATION",
  "CAUSAL",
];

export type MetricDomain =
  | "FINANCIAL"
  | "OPERATIONAL"
  | "MARKET"
  | "TECHNICAL"
  | "OTHER";

export type IngestionStatus =
  | "pending"
  | "parsing"
  | "extracting"
  | "resolving"
  | "writing"
  | "completed"
  | "failed";

export type BlockType =
  | "heading"
  | "paragraph"
  | "table"
  | "figure"
  | "list"
  | "footnote"
  | "header"
  | "footer"
  | "data_row";
