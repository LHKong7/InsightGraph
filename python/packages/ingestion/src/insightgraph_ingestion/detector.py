from __future__ import annotations

from pathlib import Path

SUPPORTED_FORMATS = {"pdf", "docx", "html", "md", "txt", "csv", "json"}

# Magic bytes for format detection
_MAGIC_BYTES = {
    b"%PDF": "pdf",
    b"PK": "docx",  # ZIP-based (DOCX, XLSX, etc.)
}


def detect_format(file_path: Path) -> str:
    """Detect file format by extension, falling back to magic bytes.

    Returns the format string (e.g., "pdf", "docx").
    Raises ValueError if format is unsupported.
    """
    # Try extension first
    ext = file_path.suffix.lower().lstrip(".")
    if ext in SUPPORTED_FORMATS:
        return ext

    # Fallback to magic bytes
    try:
        with open(file_path, "rb") as f:
            header = f.read(8)
        for magic, fmt in _MAGIC_BYTES.items():
            if header.startswith(magic):
                return fmt
    except OSError:
        pass

    raise ValueError(f"Unsupported file format: {file_path.suffix or 'unknown'}")
