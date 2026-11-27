"""Temporary roots for backend tests. Import this before the FastAPI app."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _ensure_env() -> Path:
    existing = os.environ.get("H3_TEST_ROOT", "").strip()
    if existing:
        return Path(existing)

    root = Path(tempfile.mkdtemp(prefix="h3-jobs-"))
    outputs = root / "outputs"
    comfy_input = root / "comfy" / "input"
    os.environ["H3_TEST_ROOT"] = str(root)
    os.environ["OUTPUTS_DIR"] = str(outputs)
    os.environ["FRAMES_OUTPUT_DIR"] = str(outputs / "frames")
    os.environ["COMFYUI_ROOT"] = str(root / "comfy")
    os.environ["COMFYUI_APP_DIR"] = str(root / "comfy")
    os.environ["COMFYUI_INPUT_DIR"] = str(comfy_input)
    os.environ["COMFYUI_OUTPUT_DIR"] = str(root / "comfy" / "output")
    os.environ["COMFYUI_MODE"] = "local"
    os.environ["COMFYUI_API_BASE_URL"] = "http://127.0.0.1:9"

    for folder in (
        outputs / "videos",
        outputs / "frames",
        outputs / "films",
        outputs / "audio",
        outputs / "thumbnails",
        comfy_input,
    ):
        folder.mkdir(parents=True, exist_ok=True)
    return root


ROOT = _ensure_env()
OUTPUTS = Path(os.environ["OUTPUTS_DIR"])
COMFY_INPUT = Path(os.environ["COMFYUI_INPUT_DIR"])
