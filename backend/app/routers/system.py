"""
========================================
System Router
========================================
Description:
    System diagnostic APIs for MiniMax H3 Studio backend.

Endpoints:
    GET /api/system/health
        Basic backend health check.

    GET /api/system/paths
        Returns resolved ComfyUI paths, model paths, upload paths,
        workflow paths, and file existence diagnostics.

    GET /api/system/comfyui-check
        Checks whether ComfyUI API is reachable.

    GET /api/system/input-files
        Lists files inside ComfyUI input directory.
        Useful for verifying uploaded reference images/files.

Notes:
    This router does not generate videos yet.
    It only verifies that backend can see correct ComfyUI locations.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query

from app.core import config

router = APIRouter()


def _utc_now_iso() -> str:
    """
    Return current UTC time as ISO string.
    """
    return datetime.now(timezone.utc).isoformat()


def _fetch_url(url: str, timeout: float) -> tuple[int, str]:
    """
    Simple HTTP GET using urllib.

    Description:
        Used for lightweight ComfyUI reachability check
        without adding extra Python dependency in this step.

    Args:
        url: target URL
        timeout: request timeout in seconds

    Returns:
        tuple of HTTP status code and response body text
    """
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "User-Agent": "MiniMax-H3-Studio-Backend/0.1",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        status = getattr(response, "status", None) or response.getcode()
        return int(status), body


@router.get("/health", summary="ตรวจสอบสุขภาพ backend")
def health() -> dict[str, Any]:
    """
    Basic backend health endpoint.

    Returns:
        JSON status ok
    """
    return {
        "status": "ok",
        "service": "h3-studio-backend",
        "checked_at": _utc_now_iso(),
    }


@router.get("/paths", summary="ดู path ทั้งหมดที่ backend resolve")
def paths() -> dict[str, Any]:
    """
    Return full path snapshot.

    Description:
        Use this endpoint to verify:
        - ComfyUI root/app/input/output/models paths
        - whether model files exist
        - whether workflow template exists
        - upload limits and allowed extensions
    """
    return config.get_path_snapshot()


@router.get("/comfyui-check", summary="ตรวจสอบว่า ComfyUI API reachable หรือไม่")
def comfyui_check(
    timeout_seconds: float = Query(
        3.0,
        ge=0.5,
        le=30.0,
        description="HTTP timeout in seconds",
    )
) -> dict[str, Any]:
    """
    Check whether ComfyUI API is reachable.

    Description:
        Primary check uses /system_stats.
        If /system_stats returns 404/405, fallback checks root URL /.
        This helps distinguish:
        - ComfyUI not running
        - ComfyUI running but older/newer API endpoint difference

    Returns:
        JSON diagnostic result
    """
    base_url = config.COMFYUI_API_BASE_URL
    timeout = timeout_seconds or config.COMFYUI_REQUEST_TIMEOUT_SECONDS

    result: dict[str, Any] = {
        "checked_at": _utc_now_iso(),
        "api_base_url": base_url,
        "timeout_seconds": timeout,
        "reachable": False,
        "ok": False,
        "endpoint": None,
        "status_code": None,
        "input_dir_exists": config.COMFYUI_INPUT_DIR.exists(),
        "input_dir_is_dir": config.COMFYUI_INPUT_DIR.is_dir(),
        "output_dir_exists": config.COMFYUI_OUTPUT_DIR.exists(),
        "models_dir_exists": config.COMFYUI_MODELS_DIR.exists(),
    }

    try:
        status, body = _fetch_url(f"{base_url}/system_stats", timeout)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {
                "preview": body[:500]
            }

        result.update(
            {
                "reachable": True,
                "ok": True,
                "endpoint": "/system_stats",
                "status_code": status,
                "data": data,
            }
        )

        return result

    except urllib.error.HTTPError as exc:
        # HTTPError means server responded, so ComfyUI may be running.
        result["reachable"] = True

        if exc.code in (404, 405):
            try:
                status, body = _fetch_url(f"{base_url}/", timeout)

                result.update(
                    {
                        "ok": True,
                        "endpoint": "/",
                        "status_code": status,
                        "note": "ComfyUI root responds, but /system_stats is unavailable.",
                        "preview": body[:300],
                    }
                )

                return result

            except Exception:
                pass

        result.update(
            {
                "ok": False,
                "status_code": exc.code,
                "detail": str(exc),
            }
        )

        return result

    except urllib.error.URLError as exc:
        result.update(
            {
                "reachable": False,
                "ok": False,
                "detail": str(exc.reason),
            }
        )

        return result

    except Exception as exc:
        result.update(
            {
                "reachable": False,
                "ok": False,
                "detail": repr(exc),
            }
        )

        return result


@router.get("/input-files", summary="ดูไฟล์ใน ComfyUI input folder")
def input_files(
    limit: int = Query(
        50,
        ge=1,
        le=500,
        description="Maximum number of files to return",
    )
) -> dict[str, Any]:
    """
    List files inside ComfyUI input directory.

    Description:
        This is important for reference upload verification.
        ComfyUI LoadImage usually expects filename only,
        and the file must exist in input directory.

    Returns:
        JSON containing input directory path and file list.
    """
    input_dir = config.COMFYUI_INPUT_DIR

    if not input_dir.exists():
        return {
            "exists": False,
            "is_dir": False,
            "path": str(input_dir),
            "count": 0,
            "returned": 0,
            "files": [],
            "error": "ComfyUI input directory does not exist. Check comfyui_root / comfyui_app_dir / comfyui_input_dir in backend/config.json.",
        }

    if not input_dir.is_dir():
        return {
            "exists": True,
            "is_dir": False,
            "path": str(input_dir),
            "count": 0,
            "returned": 0,
            "files": [],
            "error": "ComfyUI input path exists but is not a directory.",
        }

    entries: list[dict[str, Any]] = []

    try:
        for child in input_dir.iterdir():
            try:
                if child.is_file():
                    stat = child.stat()

                    entries.append(
                        {
                            "name": child.name,
                            "path": str(child),
                            "size_bytes": stat.st_size,
                            "size_mb": round(stat.st_size / (1024 * 1024), 3),
                            "modified_at": datetime.fromtimestamp(
                                stat.st_mtime,
                                tz=timezone.utc,
                            ).isoformat(),
                        }
                    )
            except OSError:
                continue

    except OSError as exc:
        return {
            "exists": True,
            "is_dir": True,
            "path": str(input_dir),
            "count": 0,
            "returned": 0,
            "files": [],
            "error": f"Cannot read input directory: {exc}",
        }

    entries.sort(key=lambda item: item["modified_at"], reverse=True)

    limited = entries[:limit]

    return {
        "exists": True,
        "is_dir": True,
        "path": str(input_dir),
        "count": len(entries),
        "returned": len(limited),
        "files": limited,
    }

# ========================================
# Connection settings (Local / RunPod Pod)
# ========================================
from pydantic import BaseModel as _ConnBaseModel

from app.core import config as _conn_config
from app.services import comfyui_client as _conn_comfy


class ConnectionPayload(_ConnBaseModel):
    mode: str | None = None
    base_url: str | None = None
    runpod_pod_id: str | None = None
    auth_token: str | None = None


@router.get("/connection", summary="ดูค่าการเชื่อมต่อปัจจุบัน")
def get_connection() -> dict:
    return _conn_config.get_connection_snapshot()


@router.post("/connection", summary="บันทึกการเชื่อมต่อ (local / runpod)")
def save_connection(payload: ConnectionPayload) -> dict:
    snap = _conn_config.apply_connection_settings(
        mode=payload.mode,
        base_url=payload.base_url,
        runpod_pod_id=payload.runpod_pod_id,
        auth_token=payload.auth_token,
        persist=True,
    )
    return {"status": "ok", "connection": snap}


@router.post("/connection/test", summary="ทดสอบการเชื่อมต่อ (ไม่บันทึก)")
def test_connection(payload: ConnectionPayload | None = None) -> dict:
    old = _conn_config.get_connection_snapshot()
    old_token = _conn_config.COMFYUI_AUTH_TOKEN

    try:
        if payload is not None:
            _conn_config.apply_connection_settings(
                mode=payload.mode,
                base_url=payload.base_url,
                runpod_pod_id=payload.runpod_pod_id,
                auth_token=payload.auth_token,
                persist=False,
            )

        stats = _conn_comfy.get_system_stats()
        devices = stats.get("devices") or []
        gpu = devices[0] if devices else {}
        vram = gpu.get("vram_total")

        return {
            "ok": True,
            "connection": _conn_config.get_connection_snapshot(),
            "gpu": {
                "name": gpu.get("name"),
                "vram_total_mb": round(vram / 1024 / 1024, 1) if vram else None,
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "connection": _conn_config.get_connection_snapshot()}
    finally:
        if payload is not None:
            _conn_config.apply_connection_settings(
                mode=old["mode"],
                base_url=old["base_url"],
                runpod_pod_id=old["runpod_pod_id"],
                auth_token=old_token,
                persist=False,
            )

# ========================================
# Frame file serving (GET)
# เสิร์ฟรูปเฟรมจาก outputs/frames ให้ <img> โหลดได้
# (media router อนุญาตเฉพาะ videos/ และ thumbnails/ จึงแยกมาเสิร์ฟที่นี่)
# ========================================
from pathlib import Path as _FramePath

from fastapi import HTTPException as _FrameHTTPException
from fastapi import Query as _FrameQuery
from fastapi.responses import FileResponse as _FrameFileResponse

from app.core import config as _frame_config

_FRAME_SERVE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

_FRAME_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


@router.get("/frames/file", summary="เสิร์ฟไฟล์รูปเฟรมจาก outputs/frames")
def serve_frame_file(
    path: str = _FrameQuery(..., description="relative path เช่น frames/xxx_last.jpg"),
):
    raw = str(path or "").strip().replace("\\", "/").lstrip("/")
    rel = _FramePath(raw)

    if not raw or ".." in rel.parts:
        raise _FrameHTTPException(status_code=400, detail="path ไม่ถูกต้อง")

    if not rel.parts or rel.parts[0] != "frames":
        raise _FrameHTTPException(status_code=400, detail="รองรับเฉพาะไฟล์ใน frames/")

    if rel.suffix.lower() not in _FRAME_SERVE_EXTENSIONS:
        raise _FrameHTTPException(status_code=400, detail="นามสกุลไฟล์ไม่รองรับ")

    root = _frame_config.OUTPUTS_DIR.resolve()
    target = (root / rel).resolve()

    if not target.is_relative_to(root) or not target.is_file():
        raise _FrameHTTPException(status_code=404, detail=f"ไม่พบไฟล์เฟรม: {raw}")

    return _FrameFileResponse(
        target,
        media_type=_FRAME_MEDIA_TYPES.get(rel.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=3600"},
    )

# ========================================
# Storage stats (สำหรับ Dashboard)
# ========================================
@router.get("/storage-stats", summary="สถิติพื้นที่จัดเก็บใน outputs")
def storage_stats() -> dict:
    root = _conn_config.OUTPUTS_DIR.resolve()

    def stats(name: str) -> dict:
        d = root / name
        if not d.exists() or not d.is_dir():
            return {"count": 0, "bytes": 0}
        files = [f for f in d.iterdir() if f.is_file()]
        return {"count": len(files), "bytes": sum(f.stat().st_size for f in files)}

    videos = stats("videos")
    thumbnails = stats("thumbnails")
    frames = stats("frames")
    total = videos["bytes"] + thumbnails["bytes"] + frames["bytes"]

    return {
        "videos": videos,
        "thumbnails": thumbnails,
        "frames": frames,
        "total_bytes": total,
        "total_mb": round(total / 1024 / 1024, 1),
        "total_gb": round(total / 1024 / 1024 / 1024, 2),
    }

# ========================================
# POST /api/system/prompt-enhance
# สร้าง prompt จากรูป/วิดีโอ ด้วย Gemma บน ComfyUI
# ========================================
from pydantic import BaseModel as _PeBaseModel

from app.services import prompt_enhance_service as _pe_service


class PromptEnhancePayload(_PeBaseModel):
    story: str = ""
    template_id: str = "cinematic_fl2v"
    custom_instruction: str | None = None
    image_names: list[str] = []
    video_path: str | None = None
    max_frames: int = 6
    max_length: int = 1024
    temperature: float = 0.7
    seed: int = 0
    clip_name: str | None = None


@router.get("/prompt-templates", summary="รายการ template สำหรับสร้าง prompt")
def list_prompt_templates() -> dict:
    return {
        "templates": [
            {"id": key, "label": value["label"]}
            for key, value in _pe_service.BUILTIN_TEMPLATES.items()
        ]
    }


@router.post("/prompt-enhance", summary="สร้าง prompt จากรูป/วิดีโอ (Gemma VLM)")
def prompt_enhance(payload: PromptEnhancePayload) -> dict:
    try:
        instruction = _pe_service.compose_instruction(
            template_id=payload.template_id,
            story=payload.story,
            custom=payload.custom_instruction,
        )
    except _pe_service.PromptEnhanceError as exc:
        raise _FrameHTTPException(status_code=400, detail=str(exc)) from exc

    names = [str(n).strip() for n in (payload.image_names or []) if str(n).strip()]

    # วิดีโอ: แตกเฟรมแล้วส่งเข้า ComfyUI
    if payload.video_path:
        raw = str(payload.video_path).strip().replace("\\", "/").lstrip("/")
        rel = _FramePath(raw)

        if not raw or ".." in rel.parts or not rel.parts or rel.parts[0] != "videos":
            raise _FrameHTTPException(status_code=400, detail="video_path ต้องอยู่ใน videos/")

        root = _frame_config.OUTPUTS_DIR.resolve()
        target = (root / rel).resolve()

        if not target.is_relative_to(root) or not target.is_file():
            raise _FrameHTTPException(status_code=404, detail=f"ไม่พบวิดีโอ: {raw}")

        try:
            names.extend(
                _pe_service.prepare_video_frames(target, max_frames=payload.max_frames)
            )
        except Exception as exc:
            raise _FrameHTTPException(status_code=500, detail=f"แตกเฟรมวิดีโอไม่สำเร็จ: {exc}") from exc

    if not names:
        raise _FrameHTTPException(status_code=400, detail="ต้องมีรูปอ้างอิงหรือวิดีโออย่างน้อย 1 รายการ")

    names = names[: _pe_service.MAX_IMAGES]

    try:
        result = _pe_service.run_enhance(
            instruction=instruction,
            image_filenames=names,
            clip_name=payload.clip_name or _pe_service.DEFAULT_CLIP_NAME,
            max_length=payload.max_length,
            temperature=payload.temperature,
            seed=payload.seed,
        )
    except _pe_service.PromptEnhanceError as exc:
        raise _FrameHTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise _FrameHTTPException(status_code=500, detail=f"สร้าง prompt ไม่สำเร็จ: {exc}") from exc

    return {"status": "ok", "instruction": instruction, **result}