from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from insightgraph_worker.app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="insightgraph.parse_document")
def parse_document(self, staged_path: str, report_id: str) -> dict:
    """Parse a staged document into Document IR.

    Returns the serialized DocumentIR as a dict.
    """
    logger.info("Parsing document %s from %s", report_id, staged_path)
    return asyncio.get_event_loop().run_until_complete(_parse_async(staged_path, report_id))


async def _parse_async(staged_path: str, report_id: str) -> dict:
    from insightgraph_parser.service import ParserService

    service = ParserService()
    doc_ir = await service.parse(Path(staged_path))
    return doc_ir.model_dump(mode="json")
