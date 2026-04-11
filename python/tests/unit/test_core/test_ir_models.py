"""Tests for Document IR models."""

from insightgraph_core.ir.models import (
    Block,
    DocumentIR,
    SectionNode,
    SourceSpan,
    TableBlock,
    TableCell,
)
from insightgraph_core.types import BlockType


def test_source_span_creation():
    span = SourceSpan(page=1, start_char=0, end_char=100, text="Hello world")
    assert span.page == 1
    assert span.text == "Hello world"


def test_block_creation():
    span = SourceSpan(page=1, start_char=0, end_char=10, text="Test")
    block = Block(type=BlockType.PARAGRAPH, content="Test paragraph", source_span=span)
    assert block.type == BlockType.PARAGRAPH
    assert block.content == "Test paragraph"
    assert block.id is not None


def test_table_block():
    span = SourceSpan(page=2, start_char=0, end_char=50, text="Table data")
    cells = [
        TableCell(row=0, col=0, text="Header", is_header=True),
        TableCell(row=1, col=0, text="Value"),
    ]
    table = TableBlock(content="Table data", source_span=span, cells=cells, caption="Revenue Table")
    assert len(table.cells) == 2
    assert table.cells[0].is_header
    assert table.caption == "Revenue Table"


def test_section_node():
    span = SourceSpan(page=1, start_char=0, end_char=10, text="Test")
    block = Block(type=BlockType.PARAGRAPH, content="Content", source_span=span)
    section = SectionNode(title="Intro", level=1, order=0, blocks=[block])
    assert section.title == "Intro"
    assert len(section.blocks) == 1


def test_document_ir_iter_text_blocks(sample_document_ir: DocumentIR):
    blocks = list(sample_document_ir.iter_text_blocks())
    assert len(blocks) >= 1
    section, block = blocks[0]
    assert section.title == "Financial Highlights"
    assert isinstance(block, Block)


def test_document_ir_full_text(sample_document_ir: DocumentIR):
    text = sample_document_ir.full_text()
    assert "Revenue grew" in text


def test_document_ir_serialization(sample_document_ir: DocumentIR):
    data = sample_document_ir.model_dump(mode="json")
    restored = DocumentIR.model_validate(data)
    assert restored.title == sample_document_ir.title
    assert restored.source_filename == sample_document_ir.source_filename
    assert len(list(restored.iter_all_blocks())) == len(list(sample_document_ir.iter_all_blocks()))


def test_nested_sections():
    span = SourceSpan(page=1, start_char=0, end_char=10, text="Text")
    child_block = Block(type=BlockType.PARAGRAPH, content="Child content", source_span=span)
    child_section = SectionNode(title="Subsection", level=2, order=0, blocks=[child_block])
    parent_section = SectionNode(
        title="Parent", level=1, order=0, blocks=[], children=[child_section]
    )
    doc = DocumentIR(
        source_filename="test.pdf",
        source_format="pdf",
        sections=[parent_section],
    )
    blocks = list(doc.iter_text_blocks())
    assert len(blocks) == 1
    section, block = blocks[0]
    assert section.title == "Subsection"
    assert block.content == "Child content"
