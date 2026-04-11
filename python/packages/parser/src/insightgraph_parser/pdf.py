from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from insightgraph_core.ir.models import (
    Block,
    DocumentIR,
    SectionNode,
    SourceSpan,
    TableBlock,
    TableCell,
)
from insightgraph_core.types import BlockType
from insightgraph_parser.base import BaseParser

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


@dataclass
class _SpanInfo:
    """Font metadata collected during the first pass over every text span."""

    text: str
    font_size: float
    is_bold: bool
    font_name: str
    page: int
    block_idx: int
    start_char: int
    end_char: int


@dataclass
class _TextBlock:
    """Aggregated text block with associated span information."""

    text: str
    page: int
    start_char: int
    end_char: int
    spans: list[_SpanInfo] = field(default_factory=list)


def _is_bold_font(font_name: str) -> bool:
    """Heuristic: a font is bold if its name contains 'Bold' (case-insensitive)."""
    return "bold" in font_name.lower()


def _compute_modal_font_size(spans: list[_SpanInfo]) -> float:
    """Return the most common font size across all spans (the body text size)."""
    if not spans:
        return 12.0  # sensible default
    size_counts: Counter[float] = Counter()
    for span in spans:
        # Weight by text length so short headings don't dominate.
        rounded = round(span.font_size, 1)
        size_counts[rounded] += len(span.text)
    return size_counts.most_common(1)[0][0]


def _classify_heading(
    dominant_size: float,
    dominant_is_bold: bool,
    modal_size: float,
) -> int | None:
    """Classify a text block as a heading and return its level (1-6), or None.

    Strategy:
      - If font size is more than 1.5pt larger than modal, it is a heading.
      - Heading level is assigned by size: the largest gets level 1, next level 2, etc.
        (This function only checks *whether* the block is a heading; level assignment
        across the document is done by ``_assign_heading_levels``.)
      - If the font size equals the modal size but the text is bold, treat as a
        lower-priority heading candidate (level 6 placeholder that
        ``_assign_heading_levels`` will fix).
    """
    size_diff = dominant_size - modal_size
    if size_diff > 1.5:
        return 0  # placeholder – real level assigned later
    if dominant_is_bold and size_diff >= -0.1:
        return 0  # bold-only heading candidate
    return None


def _assign_heading_levels(
    blocks: list[tuple[_TextBlock, float, bool]],
    modal_size: float,
) -> dict[int, int]:
    """Map block indices → heading levels (1-6) based on font-size ranking.

    ``blocks`` contains ``(text_block, dominant_size, dominant_is_bold)`` tuples.
    Only blocks that are heading candidates should be passed in.
    """
    # Collect distinct sizes that are above the modal size.
    distinct_sizes: set[float] = set()
    bold_only_indices: list[int] = []
    for idx, (_, size, _is_bold) in enumerate(blocks):
        if size - modal_size > 1.5:
            distinct_sizes.add(round(size, 1))
        else:
            bold_only_indices.append(idx)

    # Sort descending – the largest size gets level 1.
    sorted_sizes = sorted(distinct_sizes, reverse=True)
    size_to_level = {s: min(i + 1, 6) for i, s in enumerate(sorted_sizes)}

    mapping: dict[int, int] = {}
    for idx, (_, size, _) in enumerate(blocks):
        rounded = round(size, 1)
        if rounded in size_to_level:
            mapping[idx] = size_to_level[rounded]
        elif idx in bold_only_indices:
            # Bold-only headings get a level one deeper than the deepest size-based level.
            mapping[idx] = min(len(sorted_sizes) + 1, 6)

    return mapping


def _dominant_span_attrs(spans: list[_SpanInfo]) -> tuple[float, bool]:
    """Return (font_size, is_bold) of the dominant span (by character count)."""
    if not spans:
        return 12.0, False
    size_counts: Counter[float] = Counter()
    bold_chars = 0
    total_chars = 0
    for s in spans:
        length = len(s.text)
        size_counts[round(s.font_size, 1)] += length
        if s.is_bold:
            bold_chars += length
        total_chars += length
    dominant_size = size_counts.most_common(1)[0][0]
    dominant_is_bold = bold_chars > total_chars / 2
    return dominant_size, dominant_is_bold


# ---------------------------------------------------------------------------
# Public parser
# ---------------------------------------------------------------------------


class PyMuPDFParser(BaseParser):
    """PDF parser backed by PyMuPDF (``pymupdf``)."""

    def supported_formats(self) -> list[str]:
        return ["pdf"]

    async def parse(self, file_path: Path) -> DocumentIR:
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"PDF file not found: {file_path}")
        if file_path.suffix.lower() != ".pdf":
            raise ValueError(f"Unsupported file format: {file_path.suffix}")

        doc = pymupdf.open(str(file_path))
        try:
            return self._process_document(doc, file_path)
        finally:
            doc.close()

    # ------------------------------------------------------------------
    # First pass: collect spans & text blocks
    # ------------------------------------------------------------------

    @staticmethod
    def _collect_spans_and_blocks(
        doc: pymupdf.Document,
    ) -> tuple[list[_SpanInfo], list[_TextBlock]]:
        """Walk every page and return (all_spans, text_blocks)."""
        all_spans: list[_SpanInfo] = []
        text_blocks: list[_TextBlock] = []
        char_offset = 0

        for page_num in range(len(doc)):
            page = doc[page_num]
            page_dict = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)

            for block_idx, block in enumerate(page_dict.get("blocks", [])):
                if block.get("type") != 0:  # only text blocks
                    continue

                block_text_parts: list[str] = []
                block_spans: list[_SpanInfo] = []

                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "")
                        if not text.strip():
                            continue
                        font_size = span.get("size", 12.0)
                        font_name = span.get("font", "")
                        is_bold = _is_bold_font(font_name) or bool(span.get("flags", 0) & (1 << 4))
                        start = char_offset
                        char_offset += len(text)
                        end = char_offset

                        si = _SpanInfo(
                            text=text,
                            font_size=font_size,
                            is_bold=is_bold,
                            font_name=font_name,
                            page=page_num + 1,
                            block_idx=block_idx,
                            start_char=start,
                            end_char=end,
                        )
                        all_spans.append(si)
                        block_spans.append(si)
                        block_text_parts.append(text)

                full_text = " ".join(block_text_parts).strip()
                if not full_text:
                    continue

                tb = _TextBlock(
                    text=full_text,
                    page=block_spans[0].page,
                    start_char=block_spans[0].start_char,
                    end_char=block_spans[-1].end_char,
                    spans=block_spans,
                )
                text_blocks.append(tb)

        return all_spans, text_blocks

    # ------------------------------------------------------------------
    # Second pass: classify blocks as headings or paragraphs
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_blocks(
        text_blocks: list[_TextBlock],
        modal_size: float,
    ) -> list[Block]:
        """Convert raw text blocks into typed ``Block`` instances."""
        # Identify heading candidates.
        heading_candidates: list[tuple[_TextBlock, float, bool]] = []
        candidate_original_indices: list[int] = []

        for idx, tb in enumerate(text_blocks):
            dom_size, dom_bold = _dominant_span_attrs(tb.spans)
            level = _classify_heading(dom_size, dom_bold, modal_size)
            if level is not None:
                heading_candidates.append((tb, dom_size, dom_bold))
                candidate_original_indices.append(idx)

        # Assign heading levels across candidates.
        level_map = _assign_heading_levels(heading_candidates, modal_size)
        # Build a quick lookup: original text_block index → heading level
        idx_to_level: dict[int, int] = {}
        for cand_idx, orig_idx in enumerate(candidate_original_indices):
            if cand_idx in level_map:
                idx_to_level[orig_idx] = level_map[cand_idx]

        blocks: list[Block] = []
        for idx, tb in enumerate(text_blocks):
            heading_level = idx_to_level.get(idx)
            if heading_level is not None:
                blocks.append(
                    Block(
                        type=BlockType.HEADING,
                        content=tb.text,
                        level=heading_level,
                        source_span=SourceSpan(
                            page=tb.page,
                            start_char=tb.start_char,
                            end_char=tb.end_char,
                            text=tb.text,
                        ),
                    )
                )
            else:
                blocks.append(
                    Block(
                        type=BlockType.PARAGRAPH,
                        content=tb.text,
                        source_span=SourceSpan(
                            page=tb.page,
                            start_char=tb.start_char,
                            end_char=tb.end_char,
                            text=tb.text,
                        ),
                    )
                )
        return blocks

    # ------------------------------------------------------------------
    # Table extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_tables(doc: pymupdf.Document, char_offset: int) -> list[TableBlock]:
        """Extract tables from every page using ``page.find_tables()``."""
        table_blocks: list[TableBlock] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            try:
                tables = page.find_tables()
            except Exception:
                logger.debug("Table extraction failed on page %d", page_num + 1)
                continue

            for table in tables:
                cells: list[TableCell] = []
                text_parts: list[str] = []
                extracted = table.extract()

                for row_idx, row in enumerate(extracted):
                    for col_idx, cell_text in enumerate(row):
                        cell_value = cell_text if cell_text is not None else ""
                        cells.append(
                            TableCell(
                                row=row_idx,
                                col=col_idx,
                                text=cell_value,
                                is_header=(row_idx == 0),
                            )
                        )
                        if cell_value.strip():
                            text_parts.append(cell_value.strip())

                full_text = " | ".join(text_parts) if text_parts else ""
                start = char_offset
                char_offset += len(full_text)
                end = char_offset

                table_blocks.append(
                    TableBlock(
                        content=full_text,
                        cells=cells,
                        source_span=SourceSpan(
                            page=page_num + 1,
                            start_char=start,
                            end_char=end,
                            text=full_text[:200],  # truncate for span preview
                        ),
                    )
                )
        return table_blocks

    # ------------------------------------------------------------------
    # Section tree construction (stack-based)
    # ------------------------------------------------------------------

    @staticmethod
    def _build_section_tree(blocks: list[Block | TableBlock]) -> list[SectionNode]:
        """Build a hierarchical section tree from an ordered list of blocks.

        Uses a stack to track the nesting depth.  When a heading is encountered
        the stack is unwound to the appropriate parent level and a new
        ``SectionNode`` is pushed.
        """
        root_sections: list[SectionNode] = []
        # Stack of (level, SectionNode).  A sentinel root at level 0 simplifies logic.
        stack: list[tuple[int, SectionNode]] = []
        section_order = 0

        # Ensure there is always a section to append non-heading blocks to.
        default_section = SectionNode(title=None, level=0, order=section_order)
        section_order += 1
        root_sections.append(default_section)
        stack.append((0, default_section))

        for block in blocks:
            if block.type == BlockType.HEADING and block.level is not None:
                level = block.level

                # Pop from stack until the top has a strictly smaller level.
                while stack and stack[-1][0] >= level:
                    stack.pop()

                new_section = SectionNode(
                    title=block.content,
                    level=level,
                    order=section_order,
                    blocks=[block],
                )
                section_order += 1

                if stack:
                    stack[-1][1].children.append(new_section)
                else:
                    root_sections.append(new_section)

                stack.append((level, new_section))
            else:
                # Append to the current (top-of-stack) section.
                if stack:
                    stack[-1][1].blocks.append(block)
                else:
                    root_sections[-1].blocks.append(block)

        # Remove the default section if it ended up empty.
        if root_sections and not root_sections[0].blocks and not root_sections[0].children:
            root_sections.pop(0)

        return root_sections

    # ------------------------------------------------------------------
    # Metadata extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_metadata(doc: pymupdf.Document) -> dict[str, str | list[str] | None]:
        meta = doc.metadata or {}
        title = meta.get("title") or None
        author_raw = meta.get("author") or ""
        authors = [a.strip() for a in author_raw.split(",") if a.strip()] if author_raw else []
        date = meta.get("creationDate") or meta.get("modDate") or None
        return {"title": title, "authors": authors, "date": date}

    # ------------------------------------------------------------------
    # Orchestrator
    # ------------------------------------------------------------------

    def _process_document(
        self,
        doc: pymupdf.Document,
        file_path: Path,
    ) -> DocumentIR:
        # First pass – collect spans and text blocks.
        all_spans, text_blocks = self._collect_spans_and_blocks(doc)
        modal_size = _compute_modal_font_size(all_spans)
        logger.debug("Modal font size: %.1f", modal_size)

        # Second pass – classify blocks.
        classified_blocks: list[Block] = self._classify_blocks(text_blocks, modal_size)

        # Compute char_offset for tables (continue after text blocks).
        max_char = max((b.source_span.end_char for b in classified_blocks), default=0)

        # Table extraction.
        table_blocks = self._extract_tables(doc, char_offset=max_char)

        # Merge blocks in page order (text blocks first, then tables).
        all_blocks: list[Block | TableBlock] = list(classified_blocks) + list(table_blocks)

        # Build section hierarchy.
        sections = self._build_section_tree(all_blocks)

        # Metadata.
        meta = self._extract_metadata(doc)

        return DocumentIR(
            source_filename=file_path.name,
            source_format="pdf",
            title=meta["title"],  # type: ignore[arg-type]
            authors=meta["authors"],  # type: ignore[arg-type]
            date=meta["date"],  # type: ignore[arg-type]
            num_pages=len(doc),
            sections=sections,
        )
