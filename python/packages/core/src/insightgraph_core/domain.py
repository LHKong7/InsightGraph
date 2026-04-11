from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class DomainConfig(BaseModel):
    """Configuration for a specific knowledge domain."""

    name: str  # e.g., "stock_analysis", "restaurant_analysis"
    description: str = ""

    # Custom entity types for this domain
    entity_types: list[str] = Field(default_factory=list)
    # e.g., ["STOCK", "NEWS_EVENT", "PRICE_MOVEMENT", "SECTOR"]
    # or ["RESTAURANT", "DISH", "INGREDIENT", "CUSTOMER_SEGMENT"]

    # Custom relationship types for this domain
    relationship_types: list[str] = Field(default_factory=list)
    # e.g., ["CAUSES_PRICE_CHANGE", "AFFECTS_SECTOR", "REPORTED_BY"]
    # or ["DRIVES_TRAFFIC", "PAIRS_WITH", "COMPETES_WITH"]

    # Domain-specific extraction instructions for the LLM
    extraction_instructions: str = ""
    # e.g., "Focus on causal relationships between news events and stock prices"

    # Example entities for few-shot prompting
    example_entities: list[dict] = Field(default_factory=list)
    # e.g., [{"name": "AAPL", "type": "STOCK"}, ...]

    # Example relationships for few-shot prompting
    example_relationships: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Built-in domain configs
# ---------------------------------------------------------------------------

STOCK_DOMAIN = DomainConfig(
    name="stock_analysis",
    description="Stock market news and price movement analysis",
    entity_types=[
        "STOCK",
        "COMPANY",
        "NEWS_EVENT",
        "PRICE_MOVEMENT",
        "SECTOR",
        "MARKET_INDEX",
        "PERSON",
        "POLICY",
    ],
    relationship_types=[
        "CAUSES_PRICE_CHANGE",
        "AFFECTS_SECTOR",
        "REPORTED_BY",
        "TRIGGERS",
        "CORRELATES_WITH",
        "HEDGES_AGAINST",
        "BELONGS_TO_SECTOR",
        "COMPETES_WITH",
    ],
    extraction_instructions=(
        "You are analyzing stock market news and price data. Extract:\n"
        "- STOCK entities (ticker symbols, company names)\n"
        "- NEWS_EVENT entities (earnings reports, product launches, regulatory changes)\n"
        "- PRICE_MOVEMENT entities (price increases/decreases with percentages)\n"
        "- Causal relationships: which news events caused which price movements\n"
        "- Focus on identifying CAUSES_PRICE_CHANGE and TRIGGERS relationships"
    ),
    example_entities=[
        {"name": "AAPL", "type": "STOCK", "description": "Apple Inc. stock"},
        {
            "name": "iPhone 16 Launch",
            "type": "NEWS_EVENT",
            "description": "Product launch event",
        },
        {
            "name": "+5.2%",
            "type": "PRICE_MOVEMENT",
            "description": "Stock price increase",
        },
    ],
    example_relationships=[
        {
            "source": "iPhone 16 Launch",
            "target": "+5.2%",
            "type": "CAUSES_PRICE_CHANGE",
            "description": "Product launch drove stock up",
        },
    ],
)

RESTAURANT_DOMAIN = DomainConfig(
    name="restaurant_analysis",
    description="Restaurant operations, dish performance, and customer traffic analysis",
    entity_types=[
        "RESTAURANT",
        "DISH",
        "INGREDIENT",
        "CUSTOMER_SEGMENT",
        "LOCATION",
        "PROMOTION",
        "SEASON",
        "COMPETITOR",
    ],
    relationship_types=[
        "DRIVES_TRAFFIC",
        "REDUCES_TRAFFIC",
        "PAIRS_WITH",
        "SUBSTITUTES_FOR",
        "POPULAR_WITH",
        "SEASONAL_IN",
        "COMPETES_WITH",
        "SERVED_AT",
    ],
    extraction_instructions=(
        "You are analyzing restaurant reports. Extract:\n"
        "- DISH entities (menu items, food categories)\n"
        "- CUSTOMER_SEGMENT entities (demographics, dining preferences)\n"
        "- RESTAURANT entities (restaurant names, chains)\n"
        "- Relationships: which dishes drive customer traffic, which segments prefer which dishes\n"
        "- Focus on DRIVES_TRAFFIC and POPULAR_WITH relationships"
    ),
    example_entities=[
        {
            "name": "Truffle Burger",
            "type": "DISH",
            "description": "Premium burger item",
        },
        {
            "name": "Weekend Families",
            "type": "CUSTOMER_SEGMENT",
            "description": "Family diners on weekends",
        },
    ],
    example_relationships=[
        {
            "source": "Truffle Burger",
            "target": "Weekend Families",
            "type": "DRIVES_TRAFFIC",
            "description": "Popular item that attracts family diners",
        },
    ],
)

BUILTIN_DOMAINS: dict[str, DomainConfig] = {
    "stock_analysis": STOCK_DOMAIN,
    "restaurant_analysis": RESTAURANT_DOMAIN,
}

# Default domain for backwards compatibility
DEFAULT_DOMAIN = DomainConfig(
    name="default",
    description="General-purpose report analysis",
    entity_types=[
        "ORGANIZATION",
        "PERSON",
        "LOCATION",
        "PRODUCT",
        "INDUSTRY",
        "EVENT",
        "OTHER",
    ],
    relationship_types=[
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
    ],
)


def load_domain_config(name_or_path: str) -> DomainConfig:
    """Load a domain config by name (built-in) or from a YAML file path.

    Args:
        name_or_path: Either a built-in domain name (e.g. ``"stock_analysis"``),
            a path to a YAML file containing a domain configuration, or
            ``"default"`` for the general-purpose domain.

    Returns:
        The resolved :class:`DomainConfig`.
    """
    if name_or_path == "default":
        return DEFAULT_DOMAIN

    if name_or_path in BUILTIN_DOMAINS:
        return BUILTIN_DOMAINS[name_or_path]

    path = Path(name_or_path)
    if path.exists():
        with open(path) as f:
            data = yaml.safe_load(f)
        return DomainConfig(**data)

    # Fallback: return the default domain
    return DomainConfig(name="default")
