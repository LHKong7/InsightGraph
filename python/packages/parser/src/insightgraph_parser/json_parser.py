from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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


class JSONParser(BaseParser):
    """Parse JSON files into DocumentIR.

    Supports two top-level shapes:

    * **Array of objects** -- each object becomes a ``DATA_ROW`` block inside a
      single section, similar to :class:`CSVParser`.
    * **Single object** -- each top-level key becomes its own section.  Scalar
      values produce a single paragraph block; nested objects/arrays are
      serialised to indented JSON text.
    """

    def supported_formats(self) -> list[str]:
        return ["json"]

    async def parse(self, file_path: Path) -> DocumentIR:
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        with open(file_path, encoding="utf-8") as f:
            data: Any = json.load(f)

        if isinstance(data, list):
            return self._parse_array(data, file_path)
        if isinstance(data, dict):
            return self._parse_object(data, file_path)

        # Scalar at the top level -- wrap in a single paragraph block
        return self._parse_scalar(data, file_path)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_array(items: list[Any], file_path: Path) -> DocumentIR:
        """Each element in the array becomes a block.

        If the elements are dicts with consistent keys the parser also emits a
        :class:`TableBlock` (analogous to a CSV).
        """
        blocks: list[Block | TableBlock] = []
        table_cells: list[TableCell] = []
        headers: list[str] = []

        for row_idx, item in enumerate(items):
            if isinstance(item, dict):
                # Derive headers from the first dict
                if row_idx == 0:
                    headers = list(item.keys())
                    for col_idx, header in enumerate(headers):
                        table_cells.append(
                            TableCell(row=0, col=col_idx, text=header, is_header=True)
                        )

                row_text = ", ".join(f"{k}: {v}" for k, v in item.items() if v is not None)
                metadata = {k: str(v) if v is not None else "" for k, v in item.items()}

                for col_idx, header in enumerate(headers):
                    cell_value = str(item.get(header, ""))
                    table_cells.append(TableCell(row=row_idx + 1, col=col_idx, text=cell_value))
            else:
                row_text = str(item)
                metadata = {"value": row_text}

            span = SourceSpan(
                page=1,
                start_char=row_idx * 100,
                end_char=(row_idx + 1) * 100,
                text=row_text,
            )
            blocks.append(
                Block(
                    type=BlockType.DATA_ROW,
                    content=row_text,
                    source_span=span,
                    metadata=metadata,
                )
            )

        # Prepend a TableBlock when we have structured dict rows
        if table_cells:
            table_span = SourceSpan(
                page=1,
                start_char=0,
                end_char=len(blocks) * 100,
                text="Full table",
            )
            table = TableBlock(
                content="JSON Data Table",
                source_span=table_span,
                cells=table_cells,
                caption=file_path.stem,
            )
            blocks.insert(0, table)

        section = SectionNode(
            title=file_path.stem,
            level=1,
            order=0,
            blocks=blocks,
        )

        row_count = len(items)
        return DocumentIR(
            source_filename=file_path.name,
            source_format="json",
            title=file_path.stem,
            num_pages=1,
            sections=[section],
            metadata={"structure": "array", "row_count": row_count, "headers": headers},
        )

    @staticmethod
    def _parse_object(data: dict[str, Any], file_path: Path) -> DocumentIR:
        """Each top-level key becomes a section."""
        sections: list[SectionNode] = []

        for order, (key, value) in enumerate(data.items()):
            if isinstance(value, (dict, list)):
                content = json.dumps(value, indent=2, default=str)
            else:
                content = str(value)

            span = SourceSpan(
                page=1,
                start_char=order * 200,
                end_char=(order + 1) * 200,
                text=content[:200],
            )
            block = Block(
                type=BlockType.PARAGRAPH,
                content=content,
                source_span=span,
                metadata={"key": key},
            )
            section = SectionNode(
                title=key,
                level=1,
                order=order,
                blocks=[block],
            )
            sections.append(section)

        return DocumentIR(
            source_filename=file_path.name,
            source_format="json",
            title=file_path.stem,
            num_pages=1,
            sections=sections,
            metadata={
                "structure": "object",
                "keys": list(data.keys()),
            },
        )

    @staticmethod
    def _parse_scalar(data: Any, file_path: Path) -> DocumentIR:
        """Handle a bare scalar value at the top level."""
        content = str(data)
        span = SourceSpan(page=1, start_char=0, end_char=len(content), text=content)
        block = Block(
            type=BlockType.PARAGRAPH,
            content=content,
            source_span=span,
        )
        section = SectionNode(
            title=file_path.stem,
            level=1,
            order=0,
            blocks=[block],
        )
        return DocumentIR(
            source_filename=file_path.name,
            source_format="json",
            title=file_path.stem,
            num_pages=1,
            sections=[section],
            metadata={"structure": "scalar"},
        )
