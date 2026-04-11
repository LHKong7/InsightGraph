from enum import StrEnum

# --- Built-in entity types (extensible via ontology) ---
# These are defaults; users can use ANY string as entity_type.
# The system treats entity_type as a free-form string, not a closed enum.

BUILTIN_ENTITY_TYPES = [
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
]


class ClaimType(StrEnum):
    FACTUAL = "FACTUAL"
    OPINION = "OPINION"
    PREDICTION = "PREDICTION"
    COMPARISON = "COMPARISON"
    RECOMMENDATION = "RECOMMENDATION"
    CAUSAL = "CAUSAL"


class MetricDomain(StrEnum):
    FINANCIAL = "FINANCIAL"
    OPERATIONAL = "OPERATIONAL"
    MARKET = "MARKET"
    TECHNICAL = "TECHNICAL"
    OTHER = "OTHER"


class IngestionStatus(StrEnum):
    PENDING = "pending"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    RESOLVING = "resolving"
    WRITING = "writing"
    COMPLETED = "completed"
    FAILED = "failed"


class BlockType(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    TABLE = "table"
    FIGURE = "figure"
    LIST = "list"
    FOOTNOTE = "footnote"
    HEADER = "header"
    FOOTER = "footer"
    DATA_ROW = "data_row"
