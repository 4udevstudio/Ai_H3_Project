"""
========================================
Media Router
========================================
Description:
    API สำหรับ serve ไฟล์ผลลัพธ์จาก outputs folder
    ใช้เปิดดูวิดีโอ/thumbnail ที่ backend คัดลอกมาจาก ComfyUI

Endpoints:
    GET /api/media/videos/{filename}
    GET /api/media/thumbnails/{filename}

Security:
    - จำกัด file_type ให้เป็น videos/thumbnails เท่านั้น
    - ใช้ Path(filename).name กัน path traversal
    - ตรวจว่า path ปลายทางอยู่ใต้ base directory จริง
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core import config

router = APIRouter()

ALLOWED_MEDIA_TYPES = {
    "videos": config.OUTPUTS_DIR / "videos",
    "thumbnails": config.OUTPUTS_DIR / "thumbnails",
}


@router.get("/{file_type}/{filename}", summary="เปิดดูไฟล์สื่อจาก outputs")
def get_media(file_type: str, filename: str) -> FileResponse:
    """
    Serve ไฟล์จาก outputs/videos หรือ outputs/thumbnails

    Args:
        file_type: videos หรือ thumbnails
        filename: ชื่อไฟล์

    Returns:
        FileResponse

    Raises:
        HTTPException 400: file_type ไม่รองรับ
        HTTPException 403: path traversal
        HTTPException 404: ไม่พบไฟล์
    """
    if file_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=400,
            detail="file_type ต้องเป็น videos หรือ thumbnails เท่านั้น",
        )

    base_dir = ALLOWED_MEDIA_TYPES[file_type].resolve()
    safe_name = Path(filename).name
    target = (base_dir / safe_name).resolve()

    try:
        if not target.is_relative_to(base_dir):
            raise HTTPException(status_code=403, detail="เส้นทางไฟล์ไม่ปลอดภัย")
    except AttributeError:
        # fallback สำหรับ Python เวอร์ชันเก่ากว่า 3.9
        if base_dir not in target.parents and target != base_dir:
            raise HTTPException(status_code=403, detail="เส้นทางไฟล์ไม่ปลอดภัย")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์สื่อ")

    return FileResponse(target)


# ========================================
# DELETE /api/media/file (Gallery/History delete)
# ========================================
# Description:
#     ลบไฟล์มีเดียจริงออกจาก OUTPUTS_DIR
#     ใช้โดย Next.js API route ตอนผู้ใช้กดลบคลิปใน Gallery/History
#
# Security:
#     - รับเฉพาะ relative path ภายใต้ videos/ หรือ thumbnails/
#     - กัน path traversal (..) และกัน path ชี้ออกนอก OUTPUTS_DIR
#     - จำกัดนามสกุลไฟล์ที่ลบได้
#
# Note:
#     ใช้ alias (_Media*) เพื่อไม่ให้ชนกับ import เดิมในไฟล์นี้

from pathlib import Path as _MediaPath

from fastapi import HTTPException as _MediaHTTPException
from fastapi import Query as _MediaQuery

from app.core import config as _media_config

_MEDIA_ALLOWED_TOP_DIRS = {"videos", "thumbnails", "frames"}

_MEDIA_ALLOWED_EXTENSIONS = {
    ".mp4", ".webm", ".mov", ".mkv", ".avi",
    ".jpg", ".jpeg", ".png", ".webp",
}


@router.delete("/file", summary="ลบไฟล์มีเดียออกจาก outputs (ใช้โดย Gallery/History)")
def delete_media_file(
    path: str = _MediaQuery(
        ...,
        description="relative path เช่น videos/xxx.mp4 หรือ thumbnails/xxx.jpg",
    ),
) -> dict:
    """
    ลบไฟล์มีเดีย 1 ไฟล์ออกจาก OUTPUTS_DIR อย่างปลอดภัย

    Returns:
        {"deleted": true/false, "path": "..."}
        - deleted=false กรณีไฟล์ไม่มีอยู่แล้ว (ถือว่าสำเร็จแบบ idempotent)
    """
    raw = str(path or "").strip().replace("\\", "/").lstrip("/")

    if not raw:
        raise _MediaHTTPException(status_code=400, detail="path ห้ามว่าง")

    rel = _MediaPath(raw)

    if ".." in rel.parts:
        raise _MediaHTTPException(
            status_code=400,
            detail="path ไม่อนุญาตให้ย้อนโฟลเดอร์ (..)",
        )

    if not rel.parts or rel.parts[0] not in _MEDIA_ALLOWED_TOP_DIRS:
        raise _MediaHTTPException(
            status_code=400,
            detail="ลบได้เฉพาะไฟล์ใน videos/ หรือ thumbnails/ เท่านั้น",
        )

    if rel.suffix.lower() not in _MEDIA_ALLOWED_EXTENSIONS:
        raise _MediaHTTPException(
            status_code=400,
            detail=f"นามสกุลไฟล์ไม่รองรับการลบ: {rel.suffix}",
        )

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    target = (outputs_root / rel).resolve()

    if not target.is_relative_to(outputs_root):
        raise _MediaHTTPException(
            status_code=400,
            detail="path อยู่นอก outputs directory ไม่อนุญาตให้ลบ",
        )

    if not target.exists():
        return {"deleted": False, "path": raw, "reason": "file_not_found"}

    if not target.is_file():
        raise _MediaHTTPException(
            status_code=400,
            detail="path นี้ไม่ใช่ไฟล์",
        )

    try:
        target.unlink()
    except OSError as exc:
        raise _MediaHTTPException(
            status_code=500,
            detail=f"ลบไฟล์ไม่สำเร็จ: {exc}",
        ) from exc

    print(f"[media] deleted file: {target}")

    return {"deleted": True, "path": raw}

# ========================================
# POST /api/media/extract-frame
# ดึงเฟรมแรก/สุดท้าย + ส่งเข้า ComfyUI input พร้อมใช้ต่อคลิป
# ========================================
import shutil as _fx_shutil
import uuid as _fx_uuid

from pydantic import BaseModel as _FxBaseModel

from app.core import config as _fx_config
from app.services import media_processor as _fx_media
from app.services import comfyui_client as _fx_comfy


class ExtractFramePayload(_FxBaseModel):
    path: str                      # เช่น "videos/xxxx.mp4"
    position: str = "last"         # "last" | "first"
    offset_from_end: int = 0       # ถอยหลังกัน motion blur
    upload_to_comfyui: bool = True # ส่งเข้า input พร้อมใช้เป็น first frame


@router.post("/extract-frame", summary="ดึงเฟรมแรก/สุดท้ายของวิดีโอ")
def extract_frame_endpoint(payload: ExtractFramePayload) -> dict:
    raw = str(payload.path or "").strip().replace("\\", "/").lstrip("/")
    rel = _MediaPath(raw)

    if not raw or ".." in rel.parts:
        raise _MediaHTTPException(400, detail="path ไม่ถูกต้อง")
    if not rel.parts or rel.parts[0] != "videos":
        raise _MediaHTTPException(400, detail="รองรับเฉพาะไฟล์ใน videos/ เท่านั้น")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    video_file = (outputs_root / rel).resolve()

    if not video_file.is_relative_to(outputs_root) or not video_file.is_file():
        raise _MediaHTTPException(404, detail=f"ไม่พบไฟล์วิดีโอ: {raw}")

    position = (payload.position or "last").strip().lower()
    if position not in {"last", "first"}:
        raise _MediaHTTPException(400, detail="position ต้องเป็น last หรือ first")

    suffix = f"{position}" if payload.offset_from_end <= 0 else f"{position}_m{payload.offset_from_end}"
    frame_name = f"{video_file.stem}_{suffix}.jpg"
    frame_path = outputs_root / "frames" / frame_name

    result = _fx_media.extract_frame(
        video_path=video_file,
        destination=frame_path,
        position=position,
        offset_from_end=payload.offset_from_end,
    )

    if not result.get("created"):
        raise _MediaHTTPException(500, detail=result.get("error") or "ดึงเฟรมไม่สำเร็จ")

    response = {
        "status": "ok",
        "frame_path": f"frames/{frame_name}",
        "position": position,
        "offset_from_end": payload.offset_from_end,
        "stored_filename": None,
    }

    # ส่งเข้า ComfyUI input เพื่อให้ node LoadImage ใช้ต่อได้ทันที
    if payload.upload_to_comfyui:
        target_name = f"chain_{video_file.stem[:8]}_{suffix}_{_fx_uuid.uuid4().hex[:8]}.jpg"

        if _fx_config.COMFYUI_IS_REMOTE:
            # Remote mode: ใช้ /upload/image ของ ComfyUI
            try:
                data = frame_path.read_bytes()
                up = _fx_comfy.upload_image_bytes(target_name, data, "image/jpeg")
                name = up.get("name") or target_name
                sub = up.get("subfolder") or ""
                response["stored_filename"] = f"{sub}/{name}" if sub else name
            except _fx_comfy.ComfyUIError as exc:
                # ถ้า /upload/image ไม่มี (404) ให้เตือนแต่ไม่ fail
                print(f"[media] ไม่สามารถอัปโหลดรูปเข้า ComfyUI remote: {exc}")
                response["stored_filename"] = None
                response["warning"] = "ComfyUI remote ไม่มี endpoint /upload/image — รูปถูกบันทึกใน outputs/frames/ แต่ไม่ได้ส่งเข้า ComfyUI"
        else:
            # Local mode: copy ไฟล์ตรงๆ เข้า COMFYUI_INPUT_DIR
            try:
                input_dir = _fx_config.COMFYUI_INPUT_DIR
                input_dir.mkdir(parents=True, exist_ok=True)
                _fx_shutil.copy2(frame_path, input_dir / target_name)
                response["stored_filename"] = target_name
            except OSError as exc:
                print(f"[media] ไม่สามารถ copy รูปเข้า ComfyUI input: {exc}")
                response["stored_filename"] = None
                response["warning"] = f"ไม่สามารถ copy รูปเข้า ComfyUI input: {exc}"

    return response

# ========================================
# POST /api/media/extract-frame
# ดึงเฟรมแรก/สุดท้ายแบบ manual + ปรับ offset ได้
# ========================================
import shutil as _fx_shutil
import uuid as _fx_uuid

from pydantic import BaseModel as _FxBaseModel

from app.core import config as _fx_config
from app.services import media_processor as _fx_media
from app.services import comfyui_client as _fx_comfy


class ExtractFramePayload(_FxBaseModel):
    path: str                      # เช่น "videos/xxxx.mp4"
    position: str = "last"         # "last" | "first"
    offset_from_end: int = 0       # ถอยหลังกัน motion blur
    upload_to_comfyui: bool = True # ส่งเข้า input พร้อมใช้เป็น first frame


@router.post("/extract-frame", summary="ดึงเฟรมแรก/สุดท้ายของวิดีโอ")
def extract_frame_endpoint(payload: ExtractFramePayload) -> dict:
    raw = str(payload.path or "").strip().replace("\\", "/").lstrip("/")
    rel = _MediaPath(raw)

    if not raw or ".." in rel.parts:
        raise _MediaHTTPException(400, detail="path ไม่ถูกต้อง")
    if not rel.parts or rel.parts[0] != "videos":
        raise _MediaHTTPException(400, detail="รองรับเฉพาะไฟล์ใน videos/ เท่านั้น")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    video_file = (outputs_root / rel).resolve()

    if not video_file.is_relative_to(outputs_root) or not video_file.is_file():
        raise _MediaHTTPException(404, detail=f"ไม่พบไฟล์วิดีโอ: {raw}")

    position = (payload.position or "last").strip().lower()
    if position not in {"last", "first"}:
        raise _MediaHTTPException(400, detail="position ต้องเป็น last หรือ first")

    suffix = f"{position}" if payload.offset_from_end <= 0 else f"{position}_m{payload.offset_from_end}"
    frame_name = f"{video_file.stem}_{suffix}.jpg"
    frame_path = outputs_root / "frames" / frame_name

    result = _fx_media.extract_frame(
        video_path=video_file,
        destination=frame_path,
        position=position,
        offset_from_end=payload.offset_from_end,
    )

    if not result.get("created"):
        raise _MediaHTTPException(500, detail=result.get("error") or "ดึงเฟรมไม่สำเร็จ")

    response = {
        "status": "ok",
        "frame_path": f"frames/{frame_name}",
        "position": position,
        "offset_from_end": payload.offset_from_end,
        "stored_filename": None,
    }

    # ส่งเข้า ComfyUI input เพื่อให้ node LoadImage ใช้ต่อได้ทันที
    if payload.upload_to_comfyui:
        data = frame_path.read_bytes()
        target_name = f"chain_{video_file.stem[:8]}_{suffix}_{_fx_uuid.uuid4().hex[:8]}.jpg"

        if _fx_config.COMFYUI_IS_REMOTE:
            up = _fx_comfy.upload_image_bytes(target_name, data, "image/jpeg")
            name = up.get("name") or target_name
            sub = up.get("subfolder") or ""
            response["stored_filename"] = f"{sub}/{name}" if sub else name
        else:
            input_dir = _fx_config.COMFYUI_INPUT_DIR
            input_dir.mkdir(parents=True, exist_ok=True)
            _fx_shutil.copy2(frame_path, input_dir / target_name)
            response["stored_filename"] = target_name

    return response

# ========================================
# POST /api/media/concat
# รวมหลายคลิปเป็นไฟล์เดียว + สร้าง thumbnail + duration
# ========================================
from datetime import datetime as _fx_datetime


class ConcatPayload(_FxBaseModel):
    paths: list[str]          # เรียงลำดับ เช่น ["videos/a.mp4", "videos/b.mp4"]
    title: str | None = None  # ชื่อคลิปผลลัพธ์ (ไม่บังคับ)


@router.post("/concat", summary="รวมหลายคลิปเป็นไฟล์เดียวด้วย ffmpeg")
def concat_videos_endpoint(payload: ConcatPayload) -> dict:
    if not payload.paths or len(payload.paths) < 2:
        raise _MediaHTTPException(400, detail="ต้องเลือกอย่างน้อย 2 คลิป")

    if len(payload.paths) > 20:
        raise _MediaHTTPException(400, detail="รวมได้สูงสุด 20 คลิปต่อครั้ง")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    resolved: list = []

    for raw in payload.paths:
        clean = str(raw or "").strip().replace("\\", "/").lstrip("/")
        rel = _MediaPath(clean)

        if not clean or ".." in rel.parts or not rel.parts or rel.parts[0] != "videos":
            raise _MediaHTTPException(400, detail=f"path ไม่ถูกต้อง: {raw}")

        target = (outputs_root / rel).resolve()
        if not target.is_relative_to(outputs_root) or not target.is_file():
            raise _MediaHTTPException(404, detail=f"ไม่พบไฟล์วิดีโอ: {raw}")

        resolved.append(target)

    stamp = _fx_datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"merged_{stamp}_{_fx_uuid.uuid4().hex[:6]}.mp4"
    destination = outputs_root / "videos" / name

    result = _fx_media.concat_videos(resolved, destination)

    if not result.get("ok"):
        raise _MediaHTTPException(500, detail=result.get("error") or "รวมคลิปไม่สำเร็จ")

    # สร้าง thumbnail + อ่าน duration ของไฟล์รวม
    thumbs_dir = outputs_root / "thumbnails"
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_dest = thumbs_dir / f"{destination.stem}.jpg"

    meta: dict = {}
    try:
        meta = _fx_media.process_video_outputs(
            video_path=destination,
            thumbnail_path=thumb_dest,
        ) or {}
    except Exception as exc:
        print(f"[media] สร้าง thumbnail สำหรับคลิปรวมไม่สำเร็จ: {exc}")

    return {
        "status": "ok",
        "video_path": f"videos/{destination.name}",
        "thumbnail_path": f"thumbnails/{thumb_dest.name}" if thumb_dest.exists() else None,
        "duration": meta.get("duration"),
        "mode": result.get("mode"),
    }

# ========================================
# POST /api/media/concat
# รวมหลายคลิปเป็นไฟล์เดียว + สร้าง thumbnail + duration
# ========================================
from datetime import datetime as _fx_datetime


class ConcatPayload(_FxBaseModel):
    paths: list[str]          # เรียงลำดับ เช่น ["videos/a.mp4", "videos/b.mp4"]
    title: str | None = None  # ชื่อคลิปผลลัพธ์ (ไม่บังคับ)


@router.post("/concat", summary="รวมหลายคลิปเป็นไฟล์เดียวด้วย ffmpeg")
def concat_videos_endpoint(payload: ConcatPayload) -> dict:
    if not payload.paths or len(payload.paths) < 2:
        raise _MediaHTTPException(400, detail="ต้องเลือกอย่างน้อย 2 คลิป")

    if len(payload.paths) > 20:
        raise _MediaHTTPException(400, detail="รวมได้สูงสุด 20 คลิปต่อครั้ง")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    resolved: list = []

    for raw in payload.paths:
        clean = str(raw or "").strip().replace("\\", "/").lstrip("/")
        rel = _MediaPath(clean)

        if not clean or ".." in rel.parts or not rel.parts or rel.parts[0] != "videos":
            raise _MediaHTTPException(400, detail=f"path ไม่ถูกต้อง: {raw}")

        target = (outputs_root / rel).resolve()
        if not target.is_relative_to(outputs_root) or not target.is_file():
            raise _MediaHTTPException(404, detail=f"ไม่พบไฟล์วิดีโอ: {raw}")

        resolved.append(target)

    stamp = _fx_datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"merged_{stamp}_{_fx_uuid.uuid4().hex[:6]}.mp4"
    destination = outputs_root / "videos" / name

    result = _fx_media.concat_videos(resolved, destination)

    if not result.get("ok"):
        raise _MediaHTTPException(500, detail=result.get("error") or "รวมคลิปไม่สำเร็จ")

    # สร้าง thumbnail + อ่าน duration ของไฟล์รวม
    thumbs_dir = outputs_root / "thumbnails"
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_dest = thumbs_dir / f"{destination.stem}.jpg"

    meta: dict = {}
    try:
        meta = _fx_media.process_video_outputs(
            video_path=destination,
            thumbnail_path=thumb_dest,
        ) or {}
    except Exception as exc:
        print(f"[media] สร้าง thumbnail สำหรับคลิปรวมไม่สำเร็จ: {exc}")

    return {
        "status": "ok",
        "video_path": f"videos/{destination.name}",
        "thumbnail_path": f"thumbnails/{thumb_dest.name}" if thumb_dest.exists() else None,
        "duration": meta.get("duration"),
        "mode": result.get("mode"),
    }

# ========================================
# Frame management (list / batch delete / send to ComfyUI)
# ========================================

_FRAME_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def _parse_frame_name(stem: str) -> tuple[str, str, int]:
    """แยก (source_id, position, offset) จากชื่อไฟล์เฟรม"""
    if stem.endswith("_first"):
        return stem[: -len("_first")], "first", 0
    idx = stem.rfind("_last_m")
    if idx >= 0:
        try:
            offset = int(stem[idx + len("_last_m"):])
        except ValueError:
            offset = 0
        return stem[:idx], "last", offset
    if stem.endswith("_last"):
        return stem[: -len("_last")], "last", 0
    return stem, "last", 0


@router.post("/frames/list", summary="รายการเฟรมทั้งหมดใน outputs/frames")
def list_frames() -> dict:
    frames_dir = _media_config.OUTPUTS_DIR / "frames"
    items: list[dict] = []

    if frames_dir.exists() and frames_dir.is_dir():
        files = [
            f for f in frames_dir.iterdir()
            if f.is_file() and f.suffix.lower() in _FRAME_EXTENSIONS
        ]
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        for f in files:
            stat = f.stat()
            source_id, position, offset = _parse_frame_name(f.stem)
            items.append({
                "path": f"frames/{f.name}",
                "filename": f.name,
                "source_id": source_id,
                "position": position,
                "offset_from_end": offset,
                "size_bytes": stat.st_size,
                "size_kb": round(stat.st_size / 1024, 1),
                "modified_at": _fx_datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })

    total = sum(i["size_bytes"] for i in items)
    return {
        "count": len(items),
        "total_size_mb": round(total / (1024 * 1024), 2),
        "frames": items,
    }


class DeleteFramesPayload(_FxBaseModel):
    paths: list[str]


@router.post("/frames/delete-batch", summary="ลบเฟรมหลายไฟล์พร้อมกัน")
def delete_frames_batch(payload: DeleteFramesPayload) -> dict:
    if not payload.paths:
        raise _MediaHTTPException(400, detail="ไม่มีรายการเฟรมที่ส่งมา")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    deleted: list[str] = []
    failed: list[str] = []

    for raw in payload.paths:
        clean = str(raw or "").strip().replace("\\", "/").lstrip("/")
        rel = _MediaPath(clean)

        if not clean or ".." in rel.parts or not rel.parts or rel.parts[0] != "frames":
            failed.append(raw)
            continue

        target = (outputs_root / rel).resolve()
        if not target.is_relative_to(outputs_root) or not target.is_file():
            failed.append(raw)
            continue

        try:
            target.unlink()
            deleted.append(clean)
        except OSError:
            failed.append(raw)

    return {"deleted": deleted, "failed": failed, "count": len(deleted)}


class SendFramePayload(_FxBaseModel):
    path: str


@router.post("/frames/send-to-comfyui", summary="ส่งเฟรมเข้า ComfyUI input ซ้ำ")
def send_frame_to_comfyui(payload: SendFramePayload) -> dict:
    clean = str(payload.path or "").strip().replace("\\", "/").lstrip("/")
    rel = _MediaPath(clean)

    if not clean or ".." in rel.parts or not rel.parts or rel.parts[0] != "frames":
        raise _MediaHTTPException(400, detail="path ไม่ถูกต้อง (ต้องอยู่ใน frames/)")

    outputs_root = _media_config.OUTPUTS_DIR.resolve()
    target = (outputs_root / rel).resolve()

    if not target.is_relative_to(outputs_root) or not target.is_file():
        raise _MediaHTTPException(404, detail=f"ไม่พบไฟล์เฟรม: {clean}")

    data = target.read_bytes()
    target_name = f"chain_{target.stem}_{_fx_uuid.uuid4().hex[:8]}{target.suffix.lower()}"

    if _fx_config.COMFYUI_IS_REMOTE:
        try:
            up = _fx_comfy.upload_image_bytes(target_name, data, "image/jpeg")
            name = up.get("name") or target_name
            sub = up.get("subfolder") or ""
            return {"stored_filename": f"{sub}/{name}" if sub else name}
        except _fx_comfy.ComfyUIError as exc:
            return {"stored_filename": None, "warning": f"ส่งเข้า ComfyUI remote ไม่สำเร็จ: {exc}"}

    input_dir = _fx_config.COMFYUI_INPUT_DIR
    input_dir.mkdir(parents=True, exist_ok=True)
    _fx_shutil.copy2(target, input_dir / target_name)
    return {"stored_filename": target_name}