from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from insightgraph_core.types import BlockType


class SourceSpan(BaseModel):
    """Exact location in the source document for evidence tracing."""

    page: int
    start_char: int
    end_char: int
    text: str


class TableCell(BaseModel):
    """A single cell in a table."""

    row: int
    col: int
    text: str
    is_header: bool = False


class Block(BaseModel):
    """A structural unit in the document (paragraph, heading, table, etc.)."""

    id: UUID = Field(default_factory=uuid4)
    type: BlockType
    content: str
    source_span: SourceSpan
    level: int | None = None  # heading level for HEADING blocks
    metadata: dict[str, Any] = Field(default_factory=dict)


class TableBlock(Block):
    """A table block with structured cell data."""

    type: BlockType = BlockType.TABLE
    cells: list[TableCell] = Field(default_factory=list)
    caption: str | None = None


class SectionNode(BaseModel):
    """A document section containing blocks and child sections."""

    id: UUID = Field(default_factory=uuid4)
    title: str | None = None
    level: int
    order: int
    blocks: list[Block | TableBlock] = Field(default_factory=list)
    children: list[SectionNode] = Field(default_factory=list)


class DocumentIR(BaseModel):
    """The complete intermediate representation of a parsed document.

    This is the canonical contract between the parser and extractor layers.
    """

    id: UUID = Field(default_factory=uuid4)
    source_filename: str
    source_format: str  # "pdf", "docx", etc.
    title: str | None = None
    authors: list[str] = Field(default_factory=list)
    date: str | None = None
    num_pages: int = 0
    parsed_at: datetime = Field(default_factory=datetime.utcnow)
    sections: list[SectionNode] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def iter_text_blocks(self) -> Iterator[tuple[SectionNode, Block]]:
        """Yield (section, block) for all text blocks in document order."""

        def _walk(section: SectionNode) -> Iterator[tuple[SectionNode, Block]]:
            for block in section.blocks:
                yield section, block
            for child in section.children:
                yield from _walk(child)

        for section in self.sections:
            yield from _walk(section)

    def iter_all_blocks(self) -> Iterator[Block]:
        """Yield all blocks regardless of section."""
        for _, block in self.iter_text_blocks():
            yield block

    def full_text(self) -> str:
        """Concatenate all text blocks."""
        return "\n".join(block.content for block in self.iter_all_blocks())
