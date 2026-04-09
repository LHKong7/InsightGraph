"""Tests for extraction result models."""

from uuid import uuid4

from insightgraph_core.ir.extraction import (
    ExtractedClaim,
    ExtractedEntity,
    ExtractedMetric,
    ExtractionResult,
    ResolvedEntity,
)
from insightgraph_core.types import ClaimType, EntityType


def test_extracted_entity():
    entity = ExtractedEntity(
        name="NVIDIA",
        type=EntityType.ORGANIZATION,
        description="GPU company",
        source_block_id=uuid4(),
        source_text="NVIDIA Corporation",
    )
    assert entity.name == "NVIDIA"
    assert entity.type == EntityType.ORGANIZATION


def test_extracted_metric():
    metric = ExtractedMetric(
        name="Revenue",
        value=5.2,
        unit="billion USD",
        period="Q3 2024",
        entity_name="NVIDIA",
        source_block_id=uuid4(),
    )
    assert metric.value == 5.2
    assert metric.period == "Q3 2024"


def test_extracted_claim():
    claim = ExtractedClaim(
        text="Strong growth driven by AI demand",
        type=ClaimType.FACTUAL,
        entities_mentioned=["NVIDIA"],
        confidence=0.9,
        source_block_id=uuid4(),
    )
    assert claim.confidence == 0.9
    assert "NVIDIA" in claim.entities_mentioned


def test_resolved_entity():
    resolved = ResolvedEntity(
        canonical_name="NVIDIA Corporation",
        type=EntityType.ORGANIZATION,
        aliases=["NVIDIA", "NVDA"],
        source_block_ids=[uuid4(), uuid4()],
    )
    assert resolved.canonical_name == "NVIDIA Corporation"
    assert len(resolved.aliases) == 2


def test_extraction_result_serialization(sample_extraction_result: ExtractionResult):
    data = sample_extraction_result.model_dump(mode="json")
    restored = ExtractionResult.model_validate(data)
    assert len(restored.entities) == len(sample_extraction_result.entities)
    assert len(restored.metrics) == len(sample_extraction_result.metrics)
    assert len(restored.claims) == len(sample_extraction_result.claims)
