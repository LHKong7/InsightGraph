from __future__ import annotations

from insightgraph_core.ir.extraction import ExtractedEntity, ExtractionResult, ResolvedEntity
from insightgraph_resolver.entity_resolver import EntityResolver


class ResolverService:
    """Service that applies entity resolution to extraction results."""

    def __init__(self, model: str = "gpt-4o-mini", api_key: str = ""):
        self._resolver = EntityResolver(model=model, api_key=api_key)

    async def resolve(self, result: ExtractionResult) -> ExtractionResult:
        """Resolve entities in an ExtractionResult and return updated result."""
        resolved = await self._resolver.resolve(result.entities)

        # Update claims with canonical entity names
        canonical_map = self._build_canonical_map(result.entities, resolved)
        for claim in result.claims:
            claim.entities_mentioned = [
                canonical_map.get(name, name) for name in claim.entities_mentioned
            ]

        # Update metrics with canonical entity names
        for metric in result.metrics:
            if metric.entity_name:
                metric.entity_name = canonical_map.get(metric.entity_name, metric.entity_name)

        return ExtractionResult(
            document_id=result.document_id,
            entities=result.entities,
            metrics=result.metrics,
            claims=result.claims,
            resolved_entities=resolved,
        )

    @staticmethod
    def _build_canonical_map(
        entities: list[ExtractedEntity], resolved: list[ResolvedEntity]
    ) -> dict[str, str]:
        """Build a mapping from original entity names to canonical names."""
        mapping: dict[str, str] = {}
        for re in resolved:
            mapping[re.canonical_name] = re.canonical_name
            for alias in re.aliases:
                mapping[alias] = re.canonical_name
        return mapping
