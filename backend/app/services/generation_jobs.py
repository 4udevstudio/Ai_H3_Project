"""
Queue one MiniMax H3 scene on the existing in-memory generation queue.

Modes map onto the workflows already built by ``h3_service`` / ``workflow_service``:

- T2V / T2V_LOW (gguf)
- REF2VA / REF2VA_LOW (gguf)
- FL2VA / FL2VA_LOW (gguf)

``first_frame`` is the previous scene's last frame.

- FL2VA injects it as LoadImage node 900 (``first_frame`` on the image-to-video
  node). The GGUF FL2VA template writes it to the template's first-frame
  LoadImage node. ``last_frame`` is node 901 on the non-GGUF FL2VA workflow.
  The GGUF FL2VA template has no end-frame input, so ``last_frame`` is ignored
  for ``gguf=true`` FL2VA.
- REF2VA's ``MiniMaxH3ReferenceToVideo`` node has reference-image inputs only.
  It has no start-image / ``first_frame`` socket, so a provided ``first_frame``
  is prepended as reference image 0. That keeps the previous frame visible to
  the model, but it is not a temporal FL2VA handoff. ``last_frame`` is ignored.
- T2V ignores ``first_frame``, ``last_frame``, and ``ref_images``.

Pixel size defaults to 960x544, which is what ResolutionSelector produces for
0.5 MP at 16:9 with ``multiple`` 16. CreateVideo nodes in the H3 workflows
hardcode ``fps`` 24, so a different ``fps`` is accepted and ignored for
generation. Export honors ``fps``.
"""
from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from app.core import config
from app.services.film_paths import FilmPathError, resolve_shared_file
from app.services.queue_service import queue_service

DEFAULT_WIDTH = 960
DEFAULT_HEIGHT = 544
DEFAULT_FPS = 24
DEFAULT_STEPS = 6

_ASPECTS: tuple[tuple[str, float], ...] = (
    ("1:1 (Square)", 1.0),
    ("2:3 (Portrait Photo)", 2 / 3),
    ("3:2 (Photo)", 3 / 2),
    ("3:4 (Portrait Standard)", 3 / 4),
    ("4:3 (Standard)", 4 / 3),
    ("9:16 (Portrait Widescreen)", 9 / 16),
    ("16:9 (Widescreen)", 16 / 9),
    ("21:9 (Ultrawide)", 21 / 9),
)

_MODES = {"T2V", "REF2VA", "FL2VA"}


class GenerationRequestError(ValueError):
    """The scene cannot be queued."""


def resolution_for(width: int | None, height: int | None) -> tuple[str, str]:
    """
    Map pixel size onto the resolution string and aspect label the H3 engine uses.

    Omitted size, or exactly 960x544, stays on the existing 0.5 MP / 16:9 default.
    """
    if width is None and height is None:
        return "0.5 MP", "16:9 (Widescreen)"

    w = DEFAULT_WIDTH if width is None else int(width)
    h = DEFAULT_HEIGHT if height is None else int(height)
    if w <= 0 or h <= 0:
        raise GenerationRequestError("width and height must be positive")

    if (w, h) == (DEFAULT_WIDTH, DEFAULT_HEIGHT):
        return "0.5 MP", "16:9 (Widescreen)"

    ratio = w / h
    aspect = min(_ASPECTS, key=lambda item: abs(item[1] - ratio))[0]
    megapixels = (w * h) / (1024 * 1024)
    megapixels = max(0.1, min(2.0, megapixels))
    return f"{megapixels:.4f} MP", aspect


def workflow_type_for(mode: str, gguf: bool) -> str:
    key = str(mode or "").strip().upper()
    if key not in _MODES:
        raise GenerationRequestError("mode must be T2V, REF2VA, or FL2VA")
    return f"{key}_LOW" if gguf else key


def enqueue_scene(
    prompt: str,
    mode: str,
    gguf: bool,
    duration: float,
    seed: int = -1,
    width: int | None = None,
    height: int | None = None,
    ref_images: list[str] | None = None,
    first_frame: str | None = None,
    last_frame: str | None = None,
) -> str:
    """
    Copy shared images into the ComfyUI input folder and enqueue one scene.

    Returns the existing queue job id. The generation worker runs jobs in order.
    """
    text = " ".join((prompt or "").split())
    if not text:
        raise GenerationRequestError("prompt is empty")

    try:
        duration_seconds = float(duration)
    except (TypeError, ValueError) as exc:
        raise GenerationRequestError("duration must be a number") from exc
    if duration_seconds <= 0:
        raise GenerationRequestError("duration must be positive")

    wtype = workflow_type_for(mode, gguf)
    resolution, aspect = resolution_for(width, height)
    base_mode = "REF2VA" if wtype.startswith("REF2VA") else "FL2VA" if wtype.startswith("FL2VA") else "T2V"

    staged: dict[str, str] = {}

    def stage_once(raw: str | None) -> str | None:
        if raw is None or not str(raw).strip():
            return None
        source = resolve_shared_file(str(raw))
        key = str(source.resolve())
        existing = staged.get(key)
        if existing:
            return existing
        name = _stage_image_file(source)
        staged[key] = name
        return name

    try:
        staged_refs = [name for name in (stage_once(path) for path in (ref_images or [])) if name]
        staged_first = stage_once(first_frame)
        staged_last = stage_once(last_frame) if base_mode == "FL2VA" and not gguf else None
    except FilmPathError as exc:
        raise GenerationRequestError(str(exc)) from exc
    except OSError as exc:
        raise GenerationRequestError(f"could not stage an image for ComfyUI: {exc}") from exc

    reference_names: list[str] = []
    first_name: str | None = None
    last_name: str | None = None

    if base_mode == "FL2VA":
        first_name = staged_first or (staged_refs[0] if staged_refs else None)
        last_name = staged_last
        if not first_name and not last_name:
            raise GenerationRequestError("FL2VA requires first_frame or last_frame")
        if gguf and not first_name:
            raise GenerationRequestError("FL2VA gguf requires first_frame")
    elif base_mode == "REF2VA":
        if staged_first:
            reference_names.append(staged_first)
        for name in staged_refs:
            if name not in reference_names:
                reference_names.append(name)
        reference_names = reference_names[:9]
        if not reference_names:
            raise GenerationRequestError("REF2VA requires ref_images or first_frame")

    snapshot = queue_service.create_job(
        prompt=text,
        type_=wtype,
        resolution=resolution,
        steps=DEFAULT_STEPS,
        seed=int(seed),
        duration_seconds=duration_seconds,
        aspect_ratio=aspect,
        reference_names=reference_names or None,
        first_frame_name=first_name,
        last_frame_name=last_name,
    )
    return str(snapshot["id"])


def _stage_image_file(source: Path) -> str:
    suffix = source.suffix.lower() or ".jpg"
    if suffix not in set(config.ALLOWED_IMAGE_EXTENSIONS):
        raise FilmPathError(f"not an image file: {source.name}")

    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", source.stem).strip("._")[:40] or "frame"
    filename = f"h3_{uuid.uuid4().hex[:8]}_{stem}{suffix}"

    if config.COMFYUI_IS_REMOTE:
        from app.services import comfyui_client

        uploaded = comfyui_client.upload_image_bytes(filename, source.read_bytes(), "image/jpeg")
        name = str(uploaded.get("name") or filename)
        sub = str(uploaded.get("subfolder") or "").strip()
        return f"{sub}/{name}" if sub else name

    destination_dir = config.COMFYUI_INPUT_DIR
    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination_dir / filename)
    return filename


def generation_public_view(job: dict[str, Any]) -> dict[str, Any]:
    """Map a queue snapshot onto ``GET /jobs/{id}``."""
    from app.services.film_paths import media_url

    status = {
        "PENDING": "queued",
        "RUNNING": "running",
        "DONE": "done",
        "FAILED": "failed",
        "CANCELLED": "failed",
    }.get(str(job.get("status") or ""), "failed")

    try:
        progress = int(job.get("progress") or 0)
    except (TypeError, ValueError):
        progress = 0
    progress = max(0, min(100, progress))

    video_path = _clean_rel(job.get("video_path"))
    last_frame_path = _clean_rel(job.get("last_frame_path"))
    error = job.get("error")
    if status == "failed" and not error:
        error = job.get("message") or "generation failed"
    if status != "failed":
        error = None

    return {
        "status": status,
        "progress": progress,
        "error": error,
        "video_path": video_path,
        "video_url": media_url(video_path),
        "last_frame_path": last_frame_path,
        "last_frame_url": media_url(last_frame_path),
        "output_path": None,
        "output_url": None,
    }


def _clean_rel(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).replace("\\", "/").lstrip("/")
    return text or None
