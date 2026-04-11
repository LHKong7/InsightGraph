"""Shared test fixtures for InsightGraph."""

from uuid import uuid4

import pytest

from insightgraph_core.ir.extraction import (
    ExtractedClaim,
    ExtractedEntity,
    ExtractedMetric,
    ExtractionResult,
)
from insightgraph_core.ir.models import Block, DocumentIR, SectionNode, SourceSpan
from insightgraph_core.types import BlockType, ClaimType


@pytest.fixture
def sample_source_span() -> SourceSpan:
    return SourceSpan(page=1, start_char=0, end_char=50, text="Revenue grew 25% YoY to $5.2B.")


@pytest.fixture
def sample_block(sample_source_span: SourceSpan) -> Block:
    return Block(
        type=BlockType.PARAGRAPH,
        content="Revenue grew 25% YoY to $5.2B in Q3 2024, driven by strong cloud demand.",
        source_span=sample_source_span,
    )


@pytest.fixture
def sample_section(sample_block: Block) -> SectionNode:
    return SectionNode(
        title="Financial Highlights",
        level=1,
        order=0,
        blocks=[sample_block],
    )


@pytest.fixture
def sample_document_ir(sample_section: SectionNode) -> DocumentIR:
    return DocumentIR(
        source_filename="test_report.pdf",
        source_format="pdf",
        title="Q3 2024 Earnings Report",
        num_pages=10,
        sections=[sample_section],
    )


@pytest.fixture
def sample_extraction_result(sample_block: Block) -> ExtractionResult:
    block_id = sample_block.id
    return ExtractionResult(
        document_id=uuid4(),
        entities=[
            ExtractedEntity(
                name="NVIDIA",
                type="ORGANIZATION",
                description="Semiconductor company",
                source_block_id=block_id,
                source_text="NVIDIA",
            ),
        ],
        metrics=[
            ExtractedMetric(
                name="Revenue",
                value=5.2,
                unit="billion USD",
                period="Q3 2024",
                entity_name="NVIDIA",
                source_block_id=block_id,
                source_text="Revenue grew 25% YoY to $5.2B",
            ),
        ],
        claims=[
            ExtractedClaim(
                text="Revenue growth driven by strong cloud demand",
                type=ClaimType.FACTUAL,
                entities_mentioned=["NVIDIA"],
                confidence=0.9,
                source_block_id=block_id,
                source_text="driven by strong cloud demand",
            ),
        ],
    )
