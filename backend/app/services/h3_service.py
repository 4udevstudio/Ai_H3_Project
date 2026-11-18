"""
========================================
H3 Service (v7 - REF2VA + T2V + FL2VA)
========================================
Description:
    Engine จริงสำหรับประมวลผล MiniMax H3 ผ่าน ComfyUI

v7 changes:
    - เปลี่ยนชื่อ CHAIN → FL2VA (รองรับ first frame + last frame พร้อมกัน)
    - ยังรองรับ REF2VA / T2V
    - รองรับ resolution แบบ Megapixels
    - รองรับ custom LoRA
    - Dynamic progress mapping ตามประเภท workflow
    - Upscale progress ไม่กระโดด 99% ตั้งแต่ต้น
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from app.core import config
from app.services import comfyui_client, media_processor, workflow_service

if TYPE_CHECKING:
    from app.services.queue_service import QueueJob


class GenerationCancelled(RuntimeError):
    pass


IMAGE_EXTENSIONS = set(config.ALLOWED_IMAGE_EXTENSIONS)

# Defaults
DEFAULT_DURATION_SECONDS = 5.0
DEFAULT_ASPECT_RATIO = "16:9 (Widescreen)"
DEFAULT_LORA_STRENGTH = 1.0
DEFAULT_SAMPLER_NAME = "lcm"

DEFAULT_MEGAPIXELS = 0.5

MIN_MEGAPIXELS = 0.1
MAX_MEGAPIXELS = 2.0

LEGACY_RESOLUTION_TO_MEGAPIXELS = {
    "480p": 0.4,
    "768p": 1.0,
    "1080p": 2.0,
}

IGNORED_CUSTOM_LORA_VALUES = {
    "",
    "none",
    "default",
    "pika",
    "pika h3",
    "pika_h3",
    "pika_h3_flex",
    "pika_h3_flex_ref2va",
    "pika_h3_flex_fl2va",
}

UPSCALE_MODEL_LOADER_CLASS_TYPES = frozenset({
    "UNETLoader",
    "VAELoader",
})

# Workflow type constants
WORKFLOW_REF2VA = "REF2VA"
WORKFLOW_T2V = "T2V"
WORKFLOW_FL2VA = "FL2VA"


def _normalize_job_type(job_type: Optional[str]) -> str:
    """
    แปลง job.type ให้เป็น workflow type มาตรฐาน
    """
    return workflow_service.normalize_workflow_type(job_type)


def _select_reference_images(job: "QueueJob") -> list[str]:
    """
    เลือก reference image จาก job.reference_names (สูงสุด 2 ไฟล์)
    """
    names = [
        Path(str(name)).name
        for name in (job.reference_names or [])
        if str(name).strip()
    ]

    images = [
        name for name in names
        if Path(name).suffix.lower() in IMAGE_EXTENSIONS
    ]

    if not images:
        raise ValueError(
            "REF2VA ต้องมี reference image อย่างน้อย 1 ไฟล์ "
            "และไฟล์นั้นต้องมีอยู่ใน ComfyUI/input"
        )

    return images[:2]


def _normalize_megapixels_value(value: float) -> float:
    if value <= 0:
        return DEFAULT_MEGAPIXELS
    if value < MIN_MEGAPIXELS:
        return MIN_MEGAPIXELS
    if value > MAX_MEGAPIXELS:
        return MAX_MEGAPIXELS
    return value


def _megapixels_for_resolution(resolution: str) -> float:
    key = str(resolution or "").strip().lower()

    if key in LEGACY_RESOLUTION_TO_MEGAPIXELS:
        return _normalize_megapixels_value(LEGACY_RESOLUTION_TO_MEGAPIXELS[key])

    cleaned = (
        key
        .replace("megapixels", "")
        .replace("megapixel", "")
        .replace("mp", "")
        .strip()
    )

    try:
        value = float(cleaned)
        return _normalize_megapixels_value(value)
    except ValueError:
        return DEFAULT_MEGAPIXELS


def _count_sampling_steps(workflow: dict[str, Any], sigmas_node_id: Optional[str] = None) -> int:
    sigmas_raw = ""

    if sigmas_node_id:
        sigmas_node = workflow.get(sigmas_node_id)
        if isinstance(sigmas_node, dict):
            sigmas_raw = sigmas_node.get("inputs", {}).get("sigmas", "")
    else:
        for node in workflow.values():
            if isinstance(node, dict) and node.get("class_type") == "ManualSigmas":
                sigmas_raw = node.get("inputs", {}).get("sigmas", "")
                break

    parts = [
        item.strip()
        for item in str(sigmas_raw).split(",")
        if item.strip()
    ]

    if len(parts) <= 1:
        return 6

    return max(1, len(parts) - 1)


def _should_use_custom_lora(raw_lora: Optional[str]) -> bool:
    if not raw_lora:
        return False
    normalized = raw_lora.strip().lower()
    return normalized not in IGNORED_CUSTOM_LORA_VALUES


def _apply_custom_lora(
    workflow: dict[str, Any],
    custom_lora: Optional[str],
) -> None:
    if not _should_use_custom_lora(custom_lora):
        return

    lora_node_id: Optional[str] = None
    lora_node: Optional[dict[str, Any]] = None

    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") == "LoraLoaderModelOnly":
            lora_node_id = str(node_id)
            lora_node = node
            break

    if lora_node is None or lora_node_id is None:
        print(
            "[h3_service] คำเตือน: ไม่พบ node LoraLoaderModelOnly "
            f"จึงไม่สามารถใช้ custom LoRA: {custom_lora}"
        )
        return

    inputs = lora_node.get("inputs")
    if not isinstance(inputs, dict):
        inputs = {}
        lora_node["inputs"] = inputs

    clean_name = Path(str(custom_lora).strip()).name
    inputs["lora_name"] = clean_name

    print(f"[h3_service] ใช้ custom LoRA: {clean_name} ที่ node {lora_node_id}")


def _extract_upscale_progress_node_ids(
    workflow: dict[str, Any],
    all_upscale_ids: set[str],
    main_create_video_id: str,
) -> set[str]:
    progress_ids: set[str] = set()

    for node_id in all_upscale_ids:
        node = workflow.get(node_id)
        class_type = None
        if isinstance(node, dict):
            class_type = node.get("class_type")

        if class_type in UPSCALE_MODEL_LOADER_CLASS_TYPES:
            continue

        progress_ids.add(str(node_id))

    for node_id, node in workflow.items():
        if not isinstance(node_id, str):
            continue
        if not isinstance(node, dict):
            continue

        class_type = node.get("class_type")

        if class_type == "CreateVideo" and node_id != main_create_video_id:
            progress_ids.add(node_id)

    return progress_ids


def _make_progress_callback(
    job: "QueueJob",
    tracker_state: dict[str, Any],
    main_sampler_id: str,
    upscale_progress_ids: set[str],
):
    def callback(event: dict[str, Any]) -> None:
        if job.status == "CANCELLED":
            raise GenerationCancelled("งานถูกยกเลิกขณะประมวลผล")

        percent = int(event.get("percent", job.progress) or 0)
        node = event.get("node")
        message = event.get("message")
        value = event.get("value")
        max_value = event.get("max")

        if node == main_sampler_id and value is not None:
            tracker_state["ws_received_real_progress"] = True

        if node is not None and node in upscale_progress_ids:
            tracker_state["ws_received_real_progress"] = True
            tracker_state["ws_received_upscale_progress"] = True

        job.progress = max(job.progress, min(99, percent))

        if node:
            job.stage = str(node)

        if message:
            job.message = str(message)

        if value is not None:
            try:
                job.current_step = int(value)
            except Exception:
                pass

        if max_value is not None:
            try:
                job.total_steps = int(max_value)
            except Exception:
                pass

    return callback


def _build_ref2va_progress_config(workflow: dict[str, Any]) -> dict[str, Any]:
    save_video_node_id = workflow_service.get_save_video_node_id(workflow)

    progress_map = {
        "136": (5, 35),
        "125": (35, 90),
        "122": (90, 95),
        "121": (95, 97),
        "152": (97, 98),
    }

    node_messages = {
        "136": "ComfyUI กำลัง encode reference/prompt",
        "125": "ComfyUI กำลัง sampling",
        "122": "ComfyUI กำลัง decode video VAE",
        "121": "ComfyUI กำลัง decode audio VAE",
        "152": "ComfyUI กำลังประกอบวิดีโอ",
    }

    if save_video_node_id:
        progress_map[save_video_node_id] = (99, 99)
        node_messages[save_video_node_id] = "ComfyUI กำลังบันทึกวิดีโอ"

    return {
        "workflow_type": WORKFLOW_REF2VA,
        "main_sampler_id": "125",
        "main_create_video_id": "152",
        "sigmas_node_id": "147",
        "save_video_node_id": save_video_node_id,
        "progress_map": progress_map,
        "node_messages": node_messages,
    }


def _build_t2v_progress_config(workflow: dict[str, Any]) -> dict[str, Any]:
    save_video_node_id = workflow_service.get_save_video_node_id(workflow)

    progress_map = {
        "162": (5, 35),
        "156": (35, 90),
        "154": (90, 95),
        "153": (95, 97),
        "161": (97, 98),
    }

    node_messages = {
        "162": "ComfyUI กำลัง encode prompt",
        "156": "ComfyUI กำลัง sampling",
        "154": "ComfyUI กำลัง decode video VAE",
        "153": "ComfyUI กำลัง decode audio VAE",
        "161": "ComfyUI กำลังประกอบวิดีโอ",
    }

    if save_video_node_id:
        progress_map[save_video_node_id] = (99, 99)
        node_messages[save_video_node_id] = "ComfyUI กำลังบันทึกวิดีโอ"

    return {
        "workflow_type": WORKFLOW_T2V,
        "main_sampler_id": "156",
        "main_create_video_id": "161",
        "sigmas_node_id": "166",
        "save_video_node_id": save_video_node_id,
        "progress_map": progress_map,
        "node_messages": node_messages,
    }


def process_job(job: "QueueJob") -> None:
    """
    ประมวลผล QueueJob ด้วย MiniMax H3 ผ่าน ComfyUI จริง
    """
    job.stage = "validate"
    job.message = "ตรวจสอบงานและ parameter"

    workflow_type = _normalize_job_type(job.type)

    requested_duration = float(
        getattr(job, "duration_seconds", None) or DEFAULT_DURATION_SECONDS
    )

    job.message = "ตรวจสอบการเชื่อมต่อ ComfyUI"
    comfyui_client.get_system_stats()

    if workflow_type == WORKFLOW_T2V:
        job.message = "ประกอบ workflow T2V จาก template"

        workflow = workflow_service.build_t2v_workflow(
            prompt=job.prompt,
            seed=job.seed,
            duration=requested_duration,
            aspect_ratio=getattr(job, "aspect_ratio", None) or DEFAULT_ASPECT_RATIO,
            megapixels=_megapixels_for_resolution(job.resolution),
            lora_strength=DEFAULT_LORA_STRENGTH,
            sampler_name=DEFAULT_SAMPLER_NAME,
            sigmas=None,
            filename_prefix=f"video/H3_Studio_T2V_{job.id[:8]}",
        )

        progress_config = _build_t2v_progress_config(workflow)

    elif workflow_type == WORKFLOW_FL2VA:
        first_name = getattr(job, "first_frame_name", None)
        last_name = getattr(job, "last_frame_name", None)

        # fallback สำหรับ payload เก่าที่ส่งมาทาง reference_names
        if not first_name and not last_name and job.reference_names:
            first_name = job.reference_names[0]

        if not first_name and not last_name:
            raise ValueError("FL2VA ต้องมี first frame หรือ last frame อย่างน้อย 1 รูป")

        job.message = "ประกอบ workflow FL2VA (first/last frame)"

        workflow = workflow_service.build_fl2va_workflow(
            prompt=job.prompt,
            first_frame_filename=first_name,
            last_frame_filename=last_name,
            seed=job.seed,
            duration=requested_duration,
            aspect_ratio=getattr(job, "aspect_ratio", None) or DEFAULT_ASPECT_RATIO,
            megapixels=_megapixels_for_resolution(job.resolution),
            lora_strength=DEFAULT_LORA_STRENGTH,
            sampler_name=DEFAULT_SAMPLER_NAME,
            sigmas=None,
            filename_prefix=f"video/H3_Studio_FL2VA_{job.id[:8]}",
        )

        progress_config = _build_t2v_progress_config(workflow)

        for nid, node in workflow.items():
            if isinstance(node, dict) and node.get("class_type") == "LoadImage":
                progress_config["node_messages"][nid] = "ComfyUI กำลังโหลดเฟรมตั้งต้น"

    elif workflow_type == WORKFLOW_REF2VA:
        reference_images = _select_reference_images(job)

        job.message = "ประกอบ workflow REF2VA จาก template"

        workflow = workflow_service.build_ref2va_workflow(
            prompt=job.prompt,
            reference_filenames=reference_images,
            seed=job.seed,
            duration=requested_duration,
            aspect_ratio=getattr(job, "aspect_ratio", None) or DEFAULT_ASPECT_RATIO,
            megapixels=_megapixels_for_resolution(job.resolution),
            lora_strength=DEFAULT_LORA_STRENGTH,
            sampler_name=DEFAULT_SAMPLER_NAME,
            sigmas=None,
            filename_prefix=f"video/H3_Studio_REF2VA_{job.id[:8]}",
        )

        progress_config = _build_ref2va_progress_config(workflow)

    else:
        raise ValueError(
            f"ขั้นตอนปัจจุบันรองรับเฉพาะ REF2VA/T2V/FL2VA ก่อน "
            f"(ได้รับ type={job.type})"
        )

    # Apply custom LoRA
    _apply_custom_lora(
        workflow=workflow,
        custom_lora=getattr(job, "lora_used", None),
    )

    # หา upscale nodes
    all_upscale_ids = workflow_service.find_upscale_node_ids(workflow)

    upscale_progress_ids = _extract_upscale_progress_node_ids(
        workflow=workflow,
        all_upscale_ids=all_upscale_ids,
        main_create_video_id=progress_config["main_create_video_id"],
    )

    skipped_loader_ids = all_upscale_ids - upscale_progress_ids

    print(f"[h3_service] workflow type: {progress_config['workflow_type']}")

    if upscale_progress_ids:
        print(
            "[h3_service] upscale progress nodes detected: "
            f"{sorted(upscale_progress_ids)}"
        )
    else:
        print("[h3_service] no upscale progress nodes detected")

    if skipped_loader_ids:
        print(
            "[h3_service] skipped upscale model loaders from progress: "
            f"{sorted(skipped_loader_ids)}"
        )

    job.total_steps = _count_sampling_steps(
        workflow,
        sigmas_node_id=progress_config["sigmas_node_id"],
    )
    job.current_step = 0
    job.progress = 0
    job.stage = "submit"
    job.message = "ส่ง workflow เข้า ComfyUI"

    prompt_id, client_id, submit_response = comfyui_client.submit_prompt(workflow)

    job.comfyui_prompt_id = prompt_id
    job.stage = "running"
    job.message = f"ComfyUI กำลังรันงาน prompt_id={prompt_id}"

    tracker_state: dict[str, Any] = {
        "ws_received_real_progress": False,
        "ws_received_upscale_progress": False,
    }

    websocket_error: Optional[str] = None

    try:
        comfyui_client.wait_for_completion(
            prompt_id=prompt_id,
            client_id=client_id,
            progress_callback=_make_progress_callback(
                job=job,
                tracker_state=tracker_state,
                main_sampler_id=progress_config["main_sampler_id"],
                upscale_progress_ids=upscale_progress_ids,
            ),
            timeout=1800.0,
            upscale_node_ids=upscale_progress_ids,
            progress_map=progress_config["progress_map"],
            terminal_save_node_id=progress_config["save_video_node_id"],
            node_messages=progress_config["node_messages"],
            main_sampler_id=progress_config["main_sampler_id"],
        )
    except GenerationCancelled:
        # True Cancel: หยุดงานฝั่ง ComfyUI จริง
        try:
            comfyui_client.interrupt_comfyui(prompt_id)
            comfyui_client.delete_prompt_from_queue(prompt_id)
        except Exception as stop_exc:
            print(f"[h3_service] ไม่สามารถหยุด ComfyUI ได้: {stop_exc}")
        raise
    except Exception as exc:
        websocket_error = str(exc)
        job.message = (
            f"WebSocket monitor error: {websocket_error}. "
            "สลับไป polling history แทน"
        )
        print(f"[h3_service] WebSocket error สำหรับ prompt_id={prompt_id}: {websocket_error}")

    if job.status == "CANCELLED":
        raise GenerationCancelled("งานถูกยกเลิกหลัง ComfyUI เสร็จ")

    job.stage = "collect_output"

    if tracker_state["ws_received_real_progress"]:
        job.progress = max(job.progress, 90)
        job.message = "กำลังดึงผลลัพธ์จาก ComfyUI history (polling)"
    else:
        job.message = (
            "WebSocket ไม่ได้รับ progress จาก ComfyUI "
            "กำลังรอผลผ่าน history polling..."
        )
        print(
            f"[h3_service] คำเตือน: WebSocket ไม่เคยส่ง progress จริง สำหรับ "
            f"prompt_id={prompt_id} — ใช้ history polling แทน"
        )

    history_entry = comfyui_client.wait_for_history(prompt_id, timeout=1800.0)

    status = history_entry.get("status") or {}
    status_str = status.get("status_str")

    if status_str == "error":
        raise comfyui_client.ComfyUIError(
            "ComfyUI history รายงาน error: "
            + json.dumps(status, ensure_ascii=False)
        )

    output_files = comfyui_client.extract_output_files(history_entry)
    video_file = comfyui_client.choose_video_file(output_files)

    if video_file is None:
        raise RuntimeError(
            "ไม่พบไฟล์วิดีโอจาก ComfyUI output: "
            + json.dumps(output_files, ensure_ascii=False)
        )

    original_filename = str(video_file.get("filename", "output.mp4"))
    extension = Path(original_filename).suffix.lower() or ".mp4"

    videos_dir = config.OUTPUTS_DIR / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    destination = videos_dir / f"{job.id}{extension}"

    job.stage = "download"

    if tracker_state["ws_received_real_progress"]:
        job.progress = max(job.progress, 95)

    job.message = "กำลังคัดลอกไฟล์วิดีโอจาก ComfyUI มายัง outputs/videos"

    comfyui_client.download_output_file(video_file, destination, timeout=180.0)

    job.video_path = f"videos/{destination.name}"
    job.output_filename = destination.name

    # ========================================
    # ดึง last frame อัตโนมัติ (สำหรับ chain คลิปต่อเนื่อง)
    # ========================================
    frames_dir = config.FRAMES_OUTPUT_DIR
    frames_dir.mkdir(parents=True, exist_ok=True)
    last_frame_path = frames_dir / f"{job.id}_last.jpg"

    frame_result = media_processor.extract_frame(
        video_path=destination,
        destination=last_frame_path,
        position="last",
        offset_from_end=0,
    )

    if frame_result.get("created"):
        job.last_frame_path = f"frames/{last_frame_path.name}"
        print(f"[h3_service] ดึง last frame สำเร็จ: {last_frame_path.name}")
    else:
        print(f"[h3_service] ดึง last frame ไม่สำเร็จ: {frame_result.get('error')}")

    # Thumbnail + Metadata
    job.stage = "media_processing"
    job.message = "กำลังสร้าง thumbnail และอ่าน metadata จากวิดีโอ"

    thumbnails_dir = config.OUTPUTS_DIR / "thumbnails"
    thumbnails_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_destination = thumbnails_dir / f"{job.id}.jpg"

    media_meta = media_processor.process_video_outputs(
        video_path=destination,
        thumbnail_path=thumbnail_destination,
    )

    if media_meta.get("thumbnail_created"):
        job.thumbnail_path = f"thumbnails/{thumbnail_destination.name}"

    duration_value = media_meta.get("duration")
    if duration_value is not None:
        try:
            job.duration = float(duration_value)
        except Exception:
            pass

    warnings = media_meta.get("warnings") or []
    if warnings:
        print(f"[h3_service] media warnings job={job.id}: {warnings}")

    job.progress = 100
    job.current_step = job.total_steps
    job.stage = "done"
    job.status = "DONE"

    if job.thumbnail_path or job.duration is not None:
        job.message = f"เสร็จสิ้น (ComfyUI {progress_config['workflow_type']}) + thumbnail/metadata"
    else:
        job.message = f"เสร็จสิ้น (ComfyUI {progress_config['workflow_type']})"