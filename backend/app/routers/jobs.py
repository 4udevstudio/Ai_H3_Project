"""
Short-film compute API.

Next.js owns persistence and the public ``/api/films`` routes. These endpoints
are a stateless compute surface on the same machine: they never open SQLite.

- ``POST /jobs/script-to-scenes``
- ``POST /jobs/generate-scene``
- ``POST /jobs/export``
- ``GET /jobs/{job_id}``
- ``POST /jobs/upload-audio``
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core import config
from app.services.export_service import ExportRequestError, export_service
from app.services.generation_jobs import GenerationRequestError, enqueue_scene, generation_public_view
from app.services.queue_service import queue_service
from app.services.script_scene_service import ScriptModelUnavailable, split_script

router = APIRouter()


class SceneOut(BaseModel):
    prompt: str
    mode: Literal["T2V", "REF2VA", "FL2VA"]
    duration: float


class ScriptToScenesRequest(BaseModel):
    script: str = Field(..., min_length=1)
    max_scenes: int = Field(8, ge=1, le=24)
    language: str | None = None


class ScriptToScenesResponse(BaseModel):
    scenes: list[SceneOut]


class GenerateSceneRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    mode: Literal["T2V", "REF2VA", "FL2VA"]
    gguf: bool = False
    duration: float = Field(..., gt=0, le=30)
    seed: int | None = -1
    width: int | None = Field(None, ge=16, le=1920)
    height: int | None = Field(None, ge=16, le=1920)
    fps: int | None = Field(
        None,
        ge=1,
        le=60,
        description="Accepted for callers. H3 workflows render at 24 fps.",
    )
    ref_images: list[str] | None = None
    first_frame: str | None = None
    last_frame: str | None = None


class JobCreated(BaseModel):
    job_id: str


class ExportClipIn(BaseModel):
    path: str
    order: int = 0
    transition: Literal["none", "crossfade"] = "none"
    transition_duration: float = Field(0.5, ge=0, le=5)


class ExportRequest(BaseModel):
    clips: list[ExportClipIn] = Field(..., min_length=1)
    audio_path: str | None = None
    audio_volume: float | None = Field(None, ge=0, le=2)
    width: int | None = Field(None, ge=16, le=1920)
    height: int | None = Field(None, ge=16, le=1920)
    fps: int | None = Field(None, ge=1, le=60)


class JobStatus(BaseModel):
    status: Literal["queued", "running", "done", "failed"]
    progress: int = Field(..., ge=0, le=100)
    error: str | None = None
    video_path: str | None = None
    video_url: str | None = None
    last_frame_path: str | None = None
    last_frame_url: str | None = None
    output_path: str | None = None
    output_url: str | None = None


class UploadAudioResponse(BaseModel):
    audio_path: str


def _error(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": message})


@router.post("/script-to-scenes", response_model=ScriptToScenesResponse)
def script_to_scenes(payload: ScriptToScenesRequest) -> ScriptToScenesResponse | JSONResponse:
    """
    Split a script with local ComfyUI Gemma (TextGenerateV2).

    Synchronous. 503 ``{"error": "..."}`` when ComfyUI is unavailable.
    Unusable model text falls back to paragraph/sentence splitting.
    """
    script = payload.script.strip()
    if not script:
        return _error(400, "script is empty")

    try:
        scenes = split_script(script, max_scenes=payload.max_scenes, language=payload.language)
    except ScriptModelUnavailable as exc:
        return _error(503, str(exc))

    return ScriptToScenesResponse(scenes=[SceneOut(**scene) for scene in scenes])


@router.post("/generate-scene", response_model=JobCreated)
def generate_scene(payload: GenerateSceneRequest) -> JobCreated | JSONResponse:
    """
    Enqueue one H3 scene. The existing generation queue runs jobs one at a time.
    """
    try:
        job_id = enqueue_scene(
            prompt=payload.prompt,
            mode=payload.mode,
            gguf=payload.gguf,
            duration=payload.duration,
            seed=-1 if payload.seed is None else payload.seed,
            width=payload.width,
            height=payload.height,
            ref_images=payload.ref_images,
            first_frame=payload.first_frame,
            last_frame=payload.last_frame,
        )
    except GenerationRequestError as exc:
        return _error(400, str(exc))

    return JobCreated(job_id=job_id)


@router.post("/export", response_model=JobCreated)
def export_film(payload: ExportRequest) -> JobCreated | JSONResponse:
    """Queue an ffmpeg assembly. Returns immediately with ``job_id``."""
    try:
        job_id = export_service.submit(
            clips=[clip.model_dump() for clip in payload.clips],
            audio_path=payload.audio_path,
            audio_volume=payload.audio_volume,
            width=payload.width,
            height=payload.height,
            fps=payload.fps,
        )
    except ExportRequestError as exc:
        return _error(400, str(exc))

    return JobCreated(job_id=job_id)


@router.get("/{job_id}", response_model=JobStatus)
def get_job(job_id: str) -> JobStatus | JSONResponse:
    """Status for a generation job or an export job."""
    export_view = export_service.get(job_id)
    if export_view is not None:
        return JobStatus(**export_view)

    queued = queue_service.get_job(job_id)
    if queued is not None:
        return JobStatus(**generation_public_view(queued))

    return _error(404, "job not found")


@router.post("/upload-audio", response_model=UploadAudioResponse)
async def upload_audio(file: UploadFile = File(...)) -> UploadAudioResponse | JSONResponse:
    """
    Store a background track under ``outputs/audio``.

    The returned ``audio_path`` is relative to the shared outputs directory.
    """
    suffix = ""
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()

    allowed = set(config.ALLOWED_AUDIO_EXTENSIONS)
    if suffix not in allowed:
        return _error(400, f"unsupported audio type: {suffix or 'unknown'}")

    data = await file.read()
    if not data:
        return _error(400, "audio file is empty")
    if len(data) > config.UPLOAD_MAX_FILE_SIZE_BYTES:
        return _error(400, "audio file is too large")

    destination_dir = config.OUTPUTS_DIR / "audio"
    destination_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    (destination_dir / name).write_bytes(data)
    return UploadAudioResponse(audio_path=f"audio/{name}")
