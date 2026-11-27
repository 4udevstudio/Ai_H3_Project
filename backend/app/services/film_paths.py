"""
Shared-file paths for the short-film compute API.

Next.js and FastAPI run on the same machine. Callers pass paths relative to
the project outputs directory (``videos/``, ``frames/``, ``films/``, ``audio/``)
or an absolute path that already lives under outputs or the ComfyUI input
folder. Nothing here opens the SQLite database.
"""
from __future__ import annotations

from pathlib import Path

from app.core import config

MEDIA_TYPES = ("videos", "thumbnails", "frames", "films", "audio")


class FilmPathError(ValueError):
    """A caller path is empty, escapes the shared roots, or is not a file."""


def media_url(relative_path: str | None) -> str | None:
    """Map ``videos/clip.mp4`` to the existing media route."""
    if not relative_path:
        return None

    rel = str(relative_path).replace("\\", "/").lstrip("/")
    parts = rel.split("/", 1)
    if len(parts) != 2 or parts[0] not in MEDIA_TYPES:
        return None

    filename = Path(parts[1]).name
    if not filename or filename in {".", ".."}:
        return None

    return f"/api/media/{parts[0]}/{filename}"


def resolve_shared_file(raw: str) -> Path:
    """
    Resolve a caller path to a real file inside a shared root.

    Relative paths are resolved under ``OUTPUTS_DIR``. Absolute paths are
    accepted only when they stay inside outputs or ``COMFYUI_INPUT_DIR``.
    """
    text = str(raw or "").strip().replace("\\", "/")
    if not text:
        raise FilmPathError("path is empty")

    outputs_root = config.OUTPUTS_DIR.resolve()
    input_root = config.COMFYUI_INPUT_DIR.resolve()
    candidate = Path(text)

    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        if ".." in candidate.parts:
            raise FilmPathError(f"path is not allowed: {text}")
        resolved = (outputs_root / candidate).resolve()

    if not _is_inside(resolved, outputs_root) and not _is_inside(resolved, input_root):
        raise FilmPathError(f"path is outside the shared outputs directory: {text}")

    if not resolved.is_file():
        raise FilmPathError(f"file not found: {text}")

    return resolved


def relative_output(path: Path) -> str:
    """Return a forward-slash path relative to ``OUTPUTS_DIR``."""
    resolved = path.resolve()
    root = config.OUTPUTS_DIR.resolve()
    try:
        rel = resolved.relative_to(root)
    except ValueError as exc:
        raise FilmPathError(f"file is outside outputs: {path}") from exc
    return rel.as_posix()


def _is_inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True
