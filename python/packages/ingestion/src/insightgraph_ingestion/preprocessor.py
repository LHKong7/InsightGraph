from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from uuid import uuid4


def validate_file(file_path: Path, max_size_mb: int = 100) -> None:
    """Validate file exists and is within size limits.

    Raises ValueError if validation fails.
    """
    if not file_path.exists():
        raise ValueError(f"File not found: {file_path}")

    if not file_path.is_file():
        raise ValueError(f"Not a file: {file_path}")

    size_mb = file_path.stat().st_size / (1024 * 1024)
    if size_mb > max_size_mb:
        raise ValueError(f"File too large: {size_mb:.1f}MB (max {max_size_mb}MB)")


def compute_content_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of file content for deduplication."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def stage_file(file_path: Path, upload_dir: Path) -> Path:
    """Copy file to the upload directory with a unique name.

    Returns the path to the staged file.
    """
    upload_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid4().hex}_{file_path.name}"
    dest = upload_dir / unique_name
    shutil.copy2(file_path, dest)
    return dest
