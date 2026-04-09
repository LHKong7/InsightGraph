from __future__ import annotations

import json
import logging
from collections import defaultdict

import litellm

from insightgraph_core.ir.extraction import ExtractedEntity, ResolvedEntity
from insightgraph_core.types import EntityType

logger = logging.getLogger(__name__)

RESOLUTION_PROMPT = """You are an entity resolution system. Given a list of entity mentions extracted from a document, identify which mentions refer to the same real-world entity.

Group the entities and for each group provide:
- canonical_name: the most complete/formal name
- aliases: all other names that refer to the same entity
- type: the entity type
- description: a brief description if available

Respond in JSON format:
{
  "groups": [
    {
      "canonical_name": "NVIDIA Corporation",
      "aliases": ["NVIDIA", "Nvidia", "NVDA"],
      "type": "ORGANIZATION",
      "description": "Semiconductor company specializing in GPU technology"
    }
  ]
}

Entity mentions to resolve:
"""


def _normalize(name: str) -> str:
    """Basic string normalization for entity matching."""
    return name.strip().lower().replace(".", "").replace(",", "")


def _rule_based_resolve(entities: list[ExtractedEntity]) -> dict[str, list[ExtractedEntity]]:
    """Group entities by normalized name as a first pass."""
    groups: dict[str, list[ExtractedEntity]] = defaultdict(list)
    for entity in entities:
        key = _normalize(entity.name)
        groups[key].append(entity)
    return dict(groups)


class EntityResolver:
    """Resolves entity mentions to canonical entities using rules + LLM."""

    def __init__(self, model: str = "gpt-4o-mini", api_key: str = ""):
        self.model = model
        self.api_key = api_key

    async def resolve(self, entities: list[ExtractedEntity]) -> list[ResolvedEntity]:
        """Deduplicate and canonicalize entities.

        Stage 1: Rule-based grouping by normalized name.
        Stage 2: LLM-based merging for remaining ambiguous entities.
        """
        if not entities:
            return []

        # Stage 1: Group by normalized name
        groups = _rule_based_resolve(entities)

        # Build unique entity list for LLM
        unique_entities = []
        for _key, group in groups.items():
            # Pick the entity with the longest name as representative
            rep = max(group, key=lambda e: len(e.name))
            unique_entities.append(rep)

        # If few enough unique entities, skip LLM
        if len(unique_entities) <= 3:
            return self._groups_to_resolved(groups)

        # Stage 2: LLM-based resolution
        try:
            return await self._llm_resolve(unique_entities, groups)
        except Exception:
            logger.warning("LLM resolution failed, falling back to rule-based", exc_info=True)
            return self._groups_to_resolved(groups)

    async def _llm_resolve(
        self,
        unique_entities: list[ExtractedEntity],
        original_groups: dict[str, list[ExtractedEntity]],
    ) -> list[ResolvedEntity]:
        """Use LLM to merge entity groups."""
        entity_list = "\n".join(
            f"- {e.name} (type: {e.type.value}, desc: {e.description or 'N/A'})"
            for e in unique_entities
        )

        kwargs: dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are an entity resolution system."},
                {"role": "user", "content": RESOLUTION_PROMPT + entity_list},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key

        response = await litellm.acompletion(**kwargs)
        content = response.choices[0].message.content
        data = json.loads(content)

        resolved = []
        for group in data.get("groups", []):
            # Collect all source block IDs from original entities matching this group
            all_block_ids = []
            all_aliases = set()
            canonical = group["canonical_name"]
            aliases = group.get("aliases", [])
            all_aliases.add(canonical)
            all_aliases.update(aliases)

            for name in all_aliases:
                norm = _normalize(name)
                if norm in original_groups:
                    for e in original_groups[norm]:
                        all_block_ids.append(e.source_block_id)

            try:
                entity_type = EntityType(group.get("type", "OTHER"))
            except ValueError:
                entity_type = EntityType.OTHER

            resolved.append(
                ResolvedEntity(
                    canonical_name=canonical,
                    type=entity_type,
                    description=group.get("description"),
                    aliases=sorted(all_aliases - {canonical}),
                    source_block_ids=all_block_ids,
                )
            )

        return resolved

    def _groups_to_resolved(self, groups: dict[str, list[ExtractedEntity]]) -> list[ResolvedEntity]:
        """Convert rule-based groups to ResolvedEntity list."""
        resolved = []
        for _key, group in groups.items():
            rep = max(group, key=lambda e: len(e.name))
            aliases = sorted({e.name for e in group} - {rep.name})
            resolved.append(
                ResolvedEntity(
                    canonical_name=rep.name,
                    type=rep.type,
                    description=rep.description,
                    aliases=aliases,
                    source_block_ids=[e.source_block_id for e in group],
                )
            )
        return resolved
