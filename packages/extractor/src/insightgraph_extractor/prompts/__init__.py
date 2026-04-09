from __future__ import annotations

from insightgraph_extractor.prompts.claim import (
    CLAIM_SYSTEM_PROMPT,
    CLAIM_USER_TEMPLATE,
    format_claim_prompt,
)
from insightgraph_extractor.prompts.entity import (
    ENTITY_SYSTEM_PROMPT,
    ENTITY_USER_TEMPLATE,
    format_entity_prompt,
)
from insightgraph_extractor.prompts.metric import (
    METRIC_SYSTEM_PROMPT,
    METRIC_USER_TEMPLATE,
    format_metric_prompt,
)

__all__ = [
    "CLAIM_SYSTEM_PROMPT",
    "CLAIM_USER_TEMPLATE",
    "ENTITY_SYSTEM_PROMPT",
    "ENTITY_USER_TEMPLATE",
    "METRIC_SYSTEM_PROMPT",
    "METRIC_USER_TEMPLATE",
    "format_claim_prompt",
    "format_entity_prompt",
    "format_metric_prompt",
]
