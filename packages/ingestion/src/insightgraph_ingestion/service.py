from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from insightgraph_core.config import Settings
from insightgraph_core.types import IngestionStatus
from insightgraph_ingestion.detector import detect_format
from insightgraph_ingestion.preprocessor import stage_file, validate_file

logger = logging.getLogger(__name__)


@dataclass
class IngestionTask:
    """Represents a report ingestion task."""

    task_id: str = field(default_factory=lambda: uuid4().hex)
    report_id: str = field(default_factory=lambda: uuid4().hex)
    source_type: str = ""
    source_uri: str = ""
    staged_path: str = ""
    status: IngestionStatus = IngestionStatus.PENDING
    created_at: datetime = field(default_factory=datetime.utcnow)
    error: str | None = None


class IngestionService:
    """Receives files, validates, stages, and dispatches for processing."""

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or Settings()
        self._tasks: dict[str, IngestionTask] = {}

    def ingest(self, file_path: Path) -> IngestionTask:
        """Validate, detect format, stage file, and create an ingestion task."""
        validate_file(file_path, max_size_mb=self._settings.max_file_size_mb)

        source_type = detect_format(file_path)
        staged = stage_file(file_path, self._settings.upload_dir)

        task = IngestionTask(
            source_type=source_type,
            source_uri=str(file_path),
            staged_path=str(staged),
        )
        self._tasks[task.task_id] = task
        logger.info("Created ingestion task %s for %s (%s)", task.task_id, file_path, source_type)
        return task

    def get_task(self, task_id: str) -> IngestionTask | None:
        return self._tasks.get(task_id)

    def update_status(
        self, task_id: str, status: IngestionStatus, error: str | None = None
    ) -> None:
        task = self._tasks.get(task_id)
        if task:
            task.status = status
            task.error = error
