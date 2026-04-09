from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile

from insightgraph_core.types import IngestionStatus
from insightgraph_ingestion.service import IngestionService

router = APIRouter(prefix="/api/v1/reports", tags=["ingestion"])

# In-memory service instance (production would use DI)
_ingestion_service = IngestionService()


@router.post("/upload")
async def upload_report(request: Request, file: UploadFile) -> dict:
    """Upload a PDF report for processing."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    # Save uploaded file to temp location
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        task = _ingestion_service.ingest(tmp_path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    # Dispatch async processing via Celery
    try:
        from insightgraph_worker.tasks.parse import parse_document

        parse_document.delay(task.staged_path, task.report_id)
        _ingestion_service.update_status(task.task_id, IngestionStatus.PARSING)
    except Exception:
        # If Celery is not available, mark as pending for manual processing
        pass

    return {
        "task_id": task.task_id,
        "report_id": task.report_id,
        "status": task.status.value,
        "source_type": task.source_type,
    }


@router.post("/{report_id}/parse")
async def parse_report(report_id: str) -> dict:
    """Trigger parsing of an uploaded report."""
    try:
        from insightgraph_worker.tasks.parse import parse_document

        result = parse_document.delay("", report_id)
        return {"task_id": result.id, "status": "parsing"}
    except Exception as e:
        raise HTTPException(500, f"Failed to start parsing: {e}") from e


@router.post("/{report_id}/build-graph")
async def build_graph(report_id: str) -> dict:
    """Trigger KG construction for a parsed report."""
    try:
        from insightgraph_worker.tasks.build_graph import build_graph as bg_task

        result = bg_task.delay({}, report_id)
        return {"task_id": result.id, "status": "building"}
    except Exception as e:
        raise HTTPException(500, f"Failed to start graph building: {e}") from e


@router.get("/{report_id}/status")
async def get_status(report_id: str) -> dict:
    """Check pipeline status for a report."""
    # Search through tasks for this report
    for task in _ingestion_service._tasks.values():
        if task.report_id == report_id:
            return {
                "report_id": report_id,
                "task_id": task.task_id,
                "status": task.status.value,
                "error": task.error,
            }
    raise HTTPException(404, f"Report {report_id} not found")
