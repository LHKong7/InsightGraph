from __future__ import annotations

from pathlib import Path

from insightgraph_core.ir.models import DocumentIR
from insightgraph_parser.base import BaseParser
from insightgraph_parser.csv_parser import CSVParser
from insightgraph_parser.json_parser import JSONParser
from insightgraph_parser.pdf import PyMuPDFParser


class ParserService:
    """Registry-based service that delegates parsing to format-specific parsers.

    By default the service ships with a :class:`PyMuPDFParser` registered for
    the ``"pdf"`` extension.  Additional parsers can be supplied at
    construction time or registered later via :meth:`register`.
    """

    def __init__(self, parsers: dict[str, BaseParser] | None = None) -> None:
        self._parsers: dict[str, BaseParser] = parsers or {
            "pdf": PyMuPDFParser(),
            "csv": CSVParser(),
            "json": JSONParser(),
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(self, extension: str, parser: BaseParser) -> None:
        """Register a parser for a given file extension.

        Args:
            extension: Lowercase extension without leading dot, e.g. ``"docx"``.
            parser: A :class:`BaseParser` implementation.
        """
        self._parsers[extension.lower().lstrip(".")] = parser

    async def parse(self, file_path: Path) -> DocumentIR:
        """Parse a file using the appropriate registered parser.

        Args:
            file_path: Path to the document.

        Returns:
            A fully populated :class:`DocumentIR`.

        Raises:
            FileNotFoundError: If *file_path* does not exist.
            ValueError: If no parser is registered for the file's extension.
        """
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        suffix = file_path.suffix.lower().lstrip(".")
        parser = self._parsers.get(suffix)
        if not parser:
            raise ValueError(
                f"No parser registered for .{suffix} files. "
                f"Available formats: {', '.join(sorted(self._parsers))}"
            )
        return await parser.parse(file_path)

    @property
    def supported_formats(self) -> list[str]:
        """Return all currently registered file extensions."""
        return sorted(self._parsers)
