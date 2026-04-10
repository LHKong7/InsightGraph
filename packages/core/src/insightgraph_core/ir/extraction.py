from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from insightgraph_core.types import ClaimType


class ExtractedEntity(BaseModel):
    """An entity extracted from a document block."""

    name: str
    type: str  # Free-form string, not restricted to an enum
    description: str | None = None
    source_block_id: UUID
    source_text: str = ""


class ExtractedMetric(BaseModel):
    """A metric value extracted from a document block."""

    name: str
    value: float
    unit: str | None = None
    period: str | None = None
    entity_name: str | None = None
    source_block_id: UUID
    source_text: str = ""


class ExtractedClaim(BaseModel):
    """A claim or assertion extracted from a document block."""

    text: str
    type: ClaimType = ClaimType.FACTUAL
    entities_mentioned: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    source_block_id: UUID
    source_text: str = ""


class ExtractedRelationship(BaseModel):
    """A relationship between two entities extracted from a document block."""

    source_entity: str
    target_entity: str
    relationship_type: str  # Free-form string, loaded from ontology or domain config
    description: str
    confidence: float = 0.8
    source_block_id: UUID
    source_text: str = ""


class ResolvedEntity(BaseModel):
    """An entity after resolution with canonical name and aliases."""

    canonical_name: str
    type: str  # Free-form string
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    source_block_ids: list[UUID] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    """Consolidated extraction results for a document."""

    document_id: UUID
    entities: list[ExtractedEntity] = Field(default_factory=list)
    metrics: list[ExtractedMetric] = Field(default_factory=list)
    claims: list[ExtractedClaim] = Field(default_factory=list)
    relationships: list[ExtractedRelationship] = Field(default_factory=list)
    resolved_entities: list[ResolvedEntity] = Field(default_factory=list)
