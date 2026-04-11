from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from insightgraph_core.ir.models import DocumentIR


class BaseParser(ABC):
    """Abstract interface for document parsers."""

    @abstractmethod
    async def parse(self, file_path: Path) -> DocumentIR:
        """Parse a document file and return its intermediate representation.

        Args:
            file_path: Path to the document file.

        Returns:
            A fully populated DocumentIR instance.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file format is not supported by this parser.
        """
        ...

    @abstractmethod
    def supported_formats(self) -> list[str]:
        """Return the list of file extensions this parser supports.

        Returns:
            A list of lowercase file extensions without dots, e.g. ``["pdf"]``.
        """
        ...
