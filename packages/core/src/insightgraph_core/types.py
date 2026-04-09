from enum import StrEnum


class EntityType(StrEnum):
    ORGANIZATION = "ORGANIZATION"
    PERSON = "PERSON"
    LOCATION = "LOCATION"
    PRODUCT = "PRODUCT"
    INDUSTRY = "INDUSTRY"
    EVENT = "EVENT"
    OTHER = "OTHER"


class ClaimType(StrEnum):
    FACTUAL = "FACTUAL"
    OPINION = "OPINION"
    PREDICTION = "PREDICTION"
    COMPARISON = "COMPARISON"
    RECOMMENDATION = "RECOMMENDATION"


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
