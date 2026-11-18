"""
========================================
Uploads Router (Local + Remote ComfyUI)
========================================
- Local  : บันทึกไฟล์ลง COMFYUI_INPUT_DIR ตรงๆ (เหมือนเดิม)
- Remote : ส่งไฟล์เข้า ComfyUI ผ่าน POST /upload/image (RunPod Pod)
คง response contract เดิมทุกประการเพื่อให้ frontend ใช้ร่วมกันได้
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core import config
from app.services import comfyui_client

router = APIRouter()

MAX_FILES_PER_REQUEST = 10
UPLOAD_CHUNK_SIZE = 1024 * 1024


def _ensure_input_dir() -> Path:
    input_dir = config.COMFYUI_INPUT_DIR
    if not input_dir.exists():
        raise HTTPException(500, detail=f"ComfyUI input directory ไม่มีอยู่: {input_dir}")
    if not input_dir.is_dir():
        raise HTTPException(500, detail=f"ComfyUI input path ไม่ใช่โฟลเดอร์: {input_dir}")
    return input_dir


def _input_dir_label() -> str:
    if config.COMFYUI_IS_REMOTE:
        return f"{config.COMFYUI_API_BASE_URL}/input (remote)"
    return str(_ensure_input_dir())


def _get_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def _detect_reference_type(extension: str) -> str:
    if extension in set(config.ALLOWED_IMAGE_EXTENSIONS):
        return "IMAGE"
    if extension in set(config.ALLOWED_VIDEO_EXTENSIONS):
        return "VIDEO"
    if extension in set(config.ALLOWED_AUDIO_EXTENSIONS):
        return "AUDIO"
    raise ValueError(f"นามสกุล {extension} ไม่ได้รับอนุญาต")


def _sanitize_stem(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"[^\w\-.]+", "_", stem, flags=re.UNICODE)
    stem = re.sub(r"_+", "_", stem).strip("._-")
    return (stem or "reference")[:80]


def _make_unique_path(input_dir: Path, stem: str, extension: str) -> Path:
    token = uuid.uuid4().hex[:12]
    candidate = input_dir / f"{stem}_{token}{extension}"
    counter = 1
    while candidate.exists():
        candidate = input_dir / f"{stem}_{token}_{counter}{extension}"
        counter += 1
        if counter > 1000:
            raise RuntimeError("ไม่สามารถสร้างชื่อไฟล์ที่ไม่ซ้ำได้")
    return candidate


def _validate_extension(original_name: str) -> tuple[str, str]:
    extension = _get_extension(original_name)
    if not extension:
        raise HTTPException(400, detail=f"ไฟล์ {original_name} ไม่มีนามสกุล")
    if extension not in set(config.ALLOWED_REFERENCE_EXTENSIONS):
        raise HTTPException(400, detail=f"นามสกุล {extension} ไม่ได้รับอนุญาต สำหรับไฟล์ {original_name}")
    try:
        reference_type = _detect_reference_type(extension)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    return extension, reference_type


async def _save_upload_to_path(file: UploadFile, destination: Path) -> int:
    total_bytes = 0
    limit_bytes = config.UPLOAD_MAX_FILE_SIZE_BYTES
    try:
        with destination.open("wb") as out_file:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > limit_bytes:
                    raise ValueError(f"ไฟล์มีขนาดใหญ่เกินกำหนด {config.UPLOAD_MAX_FILE_SIZE_MB} MB")
                out_file.write(chunk)
        if total_bytes == 0:
            raise ValueError("ไฟล์ว่างเปล่า ไม่สามารถบันทึกได้")
        return total_bytes
    except Exception:
        try:
            destination.unlink(missing_ok=True)
        except OSError:
            pass
        raise


async def _store_remote(file: UploadFile) -> dict[str, Any]:
    original_name = file.filename or "unnamed"
    extension, reference_type = _validate_extension(original_name)

    data = await file.read()
    if not data:
        raise HTTPException(400, detail="ไฟล์ว่างเปล่า ไม่สามารถอัปโหลดได้")
    if len(data) > config.UPLOAD_MAX_FILE_SIZE_BYTES:
        raise HTTPException(413, detail=f"ไฟล์มีขนาดใหญ่เกินกำหนด {config.UPLOAD_MAX_FILE_SIZE_MB} MB")

    stem = _sanitize_stem(original_name)
    target_name = f"{stem}_{uuid.uuid4().hex[:12]}{extension}"

    try:
        result = comfyui_client.upload_image_bytes(
            target_name, data, file.content_type or "application/octet-stream"
        )
    except comfyui_client.ComfyUIError as exc:
        raise HTTPException(502, detail=str(exc)) from exc

    name = result.get("name") or target_name
    subfolder = result.get("subfolder") or ""
    stored_filename = f"{subfolder}/{name}" if subfolder else name

    return {
        "original_name": original_name,
        "stored_filename": stored_filename,
        "stored_path": f"comfyui-input:{stored_filename}",
        "type": reference_type,
        "extension": extension,
        "size_bytes": len(data),
        "size_mb": round(len(data) / (1024 * 1024), 3),
    }


async def _store_local(file: UploadFile, input_dir: Path) -> dict[str, Any]:
    original_name = file.filename or "unnamed"
    extension, reference_type = _validate_extension(original_name)

    stem = _sanitize_stem(original_name)
    destination = _make_unique_path(input_dir, stem, extension)

    try:
        size_bytes = await _save_upload_to_path(file, destination)
    except ValueError as exc:
        raise HTTPException(413, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, detail=f"บันทึกไฟล์ไม่สำเร็จ: {original_name} ({exc})") from exc

    return {
        "original_name": original_name,
        "stored_filename": destination.name,
        "stored_path": str(destination),
        "type": reference_type,
        "extension": extension,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 3),
    }


async def _store_single_reference(file: UploadFile, input_dir: Path | None) -> dict[str, Any]:
    if config.COMFYUI_IS_REMOTE:
        return await _store_remote(file)
    if input_dir is None:
        input_dir = _ensure_input_dir()
    return await _store_local(file, input_dir)


@router.post("/reference", summary="อัปโหลด reference 1 ไฟล์")
async def upload_reference_single(
    file: Annotated[UploadFile, File(description="ไฟล์ reference 1 ไฟล์")],
) -> dict[str, Any]:
    input_dir = None if config.COMFYUI_IS_REMOTE else _ensure_input_dir()
    uploaded = await _store_single_reference(file, input_dir)
    return {"status": "ok", "input_dir": _input_dir_label(), "count": 1, "uploaded": [uploaded]}


@router.post("/references", summary="อัปโหลด reference หลายไฟล์")
async def upload_references_batch(
    files: Annotated[list[UploadFile], File(description="ไฟล์ reference หลายไฟล์")],
) -> dict[str, Any]:
    if not files:
        raise HTTPException(400, detail="ไม่มีไฟล์ที่ส่งมา")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, detail=f"อัปโหลด reference ได้สูงสุด {MAX_FILES_PER_REQUEST} ไฟล์ต่อครั้ง")

    input_dir = None if config.COMFYUI_IS_REMOTE else _ensure_input_dir()

    uploaded: list[dict[str, Any]] = []
    saved_paths: list[Path] = []

    try:
        for file in files:
            item = await _store_single_reference(file, input_dir)
            if not config.COMFYUI_IS_REMOTE:
                saved_paths.append(Path(item["stored_path"]))
            uploaded.append(item)
    except HTTPException:
        if not config.COMFYUI_IS_REMOTE:
            for p in saved_paths:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
        raise
    except Exception as exc:
        if not config.COMFYUI_IS_REMOTE:
            for p in saved_paths:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
        raise HTTPException(500, detail=f"อัปโหลด reference ไม่สำเร็จ: {exc}") from exc

    return {"status": "ok", "input_dir": _input_dir_label(), "count": len(uploaded), "uploaded": uploaded}