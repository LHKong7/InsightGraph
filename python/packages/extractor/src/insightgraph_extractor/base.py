from __future__ import annotations

from abc import ABC, abstractmethod

from insightgraph_core.ir.models import Block


class BaseExtractor(ABC):
    """Abstract base class for all extraction components."""

    @abstractmethod
    async def extract(self, blocks: list[Block], context: dict | None = None) -> list:
        """Extract structured data from a list of document blocks.

        Args:
            blocks: Document blocks to extract information from.
            context: Optional context dict (e.g. document title, metadata).

        Returns:
            A list of extracted items (entities, metrics, or claims).
        """
        ...
