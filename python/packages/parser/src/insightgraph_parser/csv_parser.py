from __future__ import annotations

import csv
from pathlib import Path

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


class CSVParser(BaseParser):
    """Parse CSV files into DocumentIR.

    Each row becomes a :pyclass:`Block` of type ``DATA_ROW``.  Columns are
    stored as metadata on the block.  The first row is treated as headers.
    A single section contains all rows, preceded by a :class:`TableBlock`
    that captures the full tabular structure.
    """

    def supported_formats(self) -> list[str]:
        return ["csv"]

    async def parse(self, file_path: Path) -> DocumentIR:
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        with open(file_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers: list[str] = list(reader.fieldnames or [])

            blocks: list[Block | TableBlock] = []
            table_cells: list[TableCell] = []

            for row_idx, row in enumerate(reader):
                # Create header cells on the first iteration
                if row_idx == 0:
                    for col_idx, header in enumerate(headers):
                        table_cells.append(
                            TableCell(row=0, col=col_idx, text=header, is_header=True)
                        )

                # Build a human-readable text summary of the row
                row_text = ", ".join(f"{key}: {value}" for key, value in row.items() if value)
                span = SourceSpan(
                    page=1,
                    start_char=row_idx * 100,
                    end_char=(row_idx + 1) * 100,
                    text=row_text,
                )
                block = Block(
                    type=BlockType.DATA_ROW,
                    content=row_text,
                    source_span=span,
                    metadata=dict(row),
                )
                blocks.append(block)

                # Mirror the data into table cells for structured access
                for col_idx, header in enumerate(headers):
                    table_cells.append(
                        TableCell(
                            row=row_idx + 1,
                            col=col_idx,
                            text=row.get(header, ""),
                        )
                    )

            # Prepend a TableBlock that aggregates all cells
            if table_cells:
                table_span = SourceSpan(
                    page=1,
                    start_char=0,
                    end_char=len(blocks) * 100,
                    text="Full table",
                )
                table = TableBlock(
                    content="CSV Data Table",
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

            row_count = len(blocks) - (1 if table_cells else 0)

            return DocumentIR(
                source_filename=file_path.name,
                source_format="csv",
                title=file_path.stem,
                num_pages=1,
                sections=[section],
                metadata={"headers": headers, "row_count": row_count},
            )
