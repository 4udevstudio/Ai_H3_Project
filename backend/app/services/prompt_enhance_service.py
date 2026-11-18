"""
========================================
Prompt Enhance Service
========================================
สร้าง prompt จากภาพ/วิดีโอ ด้วย Gemma (TextGenerateV2) บน ComfyUI

โครงสร้าง workflow (ตัดมาเฉพาะ branch สร้าง text):
    CLIPLoader(gemma) ─┐
    LoadImage ×N ──────┴→ TextGenerateV2 → PreviewAny
                                              └→ history.outputs["9"].text
"""
from __future__ import annotations

import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from app.core import config
from app.services import comfyui_client, media_processor

DEFAULT_CLIP_NAME = "gemma4_e4b_it_fp8_scaled.safetensors"

NODE_TEXT_GEN = "1"
NODE_CLIP_LOADER = "2"
NODE_PREVIEW = "9"
NODE_IMAGE_START = 10

MAX_IMAGES = 6
DEFAULT_MAX_VIDEO_FRAMES = 6


class PromptEnhanceError(RuntimeError):
    pass


# ========================================
# Built-in templates ({{story}} = สิ่งที่ให้เกิดขึ้นในฉาก)
# ========================================

BUILTIN_TEMPLATES: dict[str, dict[str, str]] = {
    "cinematic_fl2v": {
        "label": "Cinematic H3 FL2V (ค่าเริ่มต้น)",
        "template": (
            "You are an expert in writing Minimax H3 video FL2V prompts.\n"
            "1. Describe this image for detail.\n"
            "2. Create a cinematic-style prompt.\n"
            '3. Story: "{{story}}"\n'
            "4. Send text prompt only: no option, no any, no question.\n"
        ),
    },
    "three_field": {
        "label": "3-field cinematic (description / soundscape / music)",
        "template": (
            "You are an expert prompt writer for MiniMax H3 cinematic video.\n"
            "Analyze the reference image(s) carefully: subject, wardrobe, pose, "
            "environment, lighting, lens and color grade.\n"
            'Story to depict: "{{story}}"\n'
            "Output EXACTLY three labelled fields and nothing else:\n"
            "integrated_multimodal_description: <one dense paragraph combining "
            "subject action, camera movement, lens, lighting and mood>\n"
            "overall_soundscape: <diegetic sounds only>\n"
            "non_diegetic_music: <score description>\n"
            "No preamble, no options, no questions.\n"
        ),
    },
    "describe_only": {
        "label": "บรรยายภาพละเอียด (ไม่ใส่ story)",
        "template": (
            "Describe the reference image(s) in precise visual detail: "
            "subject, appearance, wardrobe, pose, expression, environment, "
            "lighting direction and quality, lens focal length, depth of field, "
            "color palette and overall mood.\n"
            "Output a single flowing paragraph. No preamble, no questions.\n"
        ),
    },
    "continuation": {
        "label": "ต่อฉาก (continuing motion)",
        "template": (
            "You are an expert in writing Minimax H3 continuation prompts.\n"
            "The reference image is the LAST frame of the previous clip.\n"
            "Write a prompt that continues the motion naturally from this exact frame.\n"
            'Next beat: "{{story}}"\n'
            "Start the prompt with 'continuing the same motion, '.\n"
            "Keep subject, wardrobe, lighting and camera consistent.\n"
            "Send text prompt only: no option, no any, no question.\n"
        ),
    },
}


def compose_instruction(template_id: str, story: str, custom: Optional[str] = None) -> str:
    if custom and custom.strip():
        return custom.strip()

    tpl = BUILTIN_TEMPLATES.get(template_id)
    if not tpl:
        raise PromptEnhanceError(f"ไม่รู้จัก template: {template_id}")

    clean_story = (story or "").strip() or "Follow the reference images naturally."
    return tpl["template"].replace("{{story}}", clean_story)


# ========================================
# Push image เข้า ComfyUI input
# ========================================

def push_image_to_comfyui(path: Path) -> str:
    target = f"vlm_{uuid.uuid4().hex[:8]}{path.suffix.lower() or '.jpg'}"

    if getattr(config, "COMFYUI_IS_REMOTE", False):
        up = comfyui_client.upload_image_bytes(target, path.read_bytes(), "image/jpeg")
        name = up.get("name") or target
        sub = up.get("subfolder") or ""
        return f"{sub}/{name}" if sub else name

    config.COMFYUI_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, config.COMFYUI_INPUT_DIR / target)
    return target


def prepare_video_frames(video_path: Path, max_frames: int = DEFAULT_MAX_VIDEO_FRAMES) -> list[str]:
    """แตกเฟรมจากวิดีโอแล้วส่งเข้า ComfyUI input คืนชื่อไฟล์ทั้งหมด"""
    work_dir = config.OUTPUTS_DIR / "frames" / f"vlm_{uuid.uuid4().hex[:8]}"
    work_dir.mkdir(parents=True, exist_ok=True)

    frames = media_processor.extract_video_frames(video_path, work_dir, max_frames=max_frames)
    if not frames:
        raise PromptEnhanceError("แตกเฟรมจากวิดีโอไม่สำเร็จ")

    return [push_image_to_comfyui(f) for f in frames]


# ========================================
# Build workflow
# ========================================

def build_enhance_workflow(
    instruction: str,
    image_filenames: list[str],
    clip_name: str = DEFAULT_CLIP_NAME,
    max_length: int = 1024,
    temperature: float = 0.7,
    seed: int = 0,
) -> dict[str, Any]:
    if not instruction or not instruction.strip():
        raise PromptEnhanceError("instruction ห้ามว่างเปล่า")

    names = [str(n).strip() for n in image_filenames if str(n).strip()]
    if not names:
        raise PromptEnhanceError("ต้องมีรูปอ้างอิงอย่างน้อย 1 รูป")

    if len(names) > MAX_IMAGES:
        names = names[:MAX_IMAGES]

    # โหมด local: ตรวจว่าไฟล์อยู่ใน ComfyUI/input จริง
    if not getattr(config, "COMFYUI_IS_REMOTE", False):
        for n in names:
            clean = Path(n).name
            if not (config.COMFYUI_INPUT_DIR / clean).exists():
                raise PromptEnhanceError(f"ไม่พบรูปใน ComfyUI/input: {clean}")

    workflow: dict[str, Any] = {
        NODE_CLIP_LOADER: {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": clip_name or DEFAULT_CLIP_NAME,
                "type": "stable_diffusion",
                "device": "default",
            },
        },
        NODE_TEXT_GEN: {
            "class_type": "TextGenerateV2",
            "inputs": {
                "prompt": instruction,
                "max_length": int(max_length),
                "sampling_mode": "on",
                "sampling_mode.temperature": float(temperature),
                "sampling_mode.top_k": 64,
                "sampling_mode.top_p": 0.95,
                "sampling_mode.min_p": 0.05,
                "sampling_mode.repetition_penalty": 1.05,
                "sampling_mode.presence_penalty": 0,
                "sampling_mode.seed": int(seed),
                "thinking": False,
                "use_default_template": True,
                "mtp": "auto",
                "clip": [NODE_CLIP_LOADER, 0],
            },
        },
        NODE_PREVIEW: {
            "class_type": "PreviewAny",
            "inputs": {"source": [NODE_TEXT_GEN, 0]},
        },
    }

    for idx, name in enumerate(names, start=1):
        node_id = str(NODE_IMAGE_START + idx - 1)
        workflow[node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": Path(name).name},
        }
        workflow[NODE_TEXT_GEN]["inputs"][f"images.image{idx}"] = [node_id, 0]

    return workflow


# ========================================
# Extract text จาก history
# ========================================

def _clean_text(text: str) -> str:
    t = text.strip()

    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines).strip()

    if len(t) >= 2 and t[0] == t[-1] and t[0] in {'"', "'"}:
        t = t[1:-1].strip()

    return t


def extract_text(entry: dict[str, Any]) -> str:
    outputs = entry.get("outputs") or {}
    if not isinstance(outputs, dict):
        return ""

    ordered: list[dict] = []
    preferred = outputs.get(NODE_PREVIEW)
    if isinstance(preferred, dict):
        ordered.append(preferred)
    for node_id, out in outputs.items():
        if node_id != NODE_PREVIEW and isinstance(out, dict):
            ordered.append(out)

    chunks: list[str] = []
    for out in ordered:
        texts = out.get("text")
        if isinstance(texts, str):
            chunks.append(texts)
        elif isinstance(texts, list):
            for item in texts:
                if isinstance(item, str):
                    chunks.append(item)

    joined = "\n".join(c for c in chunks if c and c.strip())
    return _clean_text(joined)


# ========================================
# Run
# ========================================

def run_enhance(
    instruction: str,
    image_filenames: list[str],
    clip_name: str = DEFAULT_CLIP_NAME,
    max_length: int = 1024,
    temperature: float = 0.7,
    seed: int = 0,
    timeout: float = 300.0,
) -> dict[str, Any]:
    workflow = build_enhance_workflow(
        instruction=instruction,
        image_filenames=image_filenames,
        clip_name=clip_name,
        max_length=max_length,
        temperature=temperature,
        seed=seed,
    )

    prompt_id, _client_id, _resp = comfyui_client.submit_prompt(workflow)
    print(f"[prompt_enhance] submit prompt_id={prompt_id} images={len(image_filenames)}")

    deadline = time.monotonic() + timeout
    entry: Optional[dict] = None

    while time.monotonic() < deadline:
        entry = comfyui_client.get_history_entry(prompt_id)
        if entry:
            break
        time.sleep(0.6)

    if not entry:
        raise PromptEnhanceError(
            "ComfyUI ยังประมวลผลไม่เสร็จภายในเวลาที่กำหนด "
            "(อาจมีงานวิดีโอค้างอยู่ในคิว)"
        )

    status = (entry.get("status") or {}).get("status_str")
    if status == "error":
        raise PromptEnhanceError("ComfyUI รายงาน error ระหว่างสร้าง prompt")

    text = extract_text(entry)
    if not text:
        raise PromptEnhanceError(
            "ไม่ได้ข้อความกลับจาก PreviewAny — ตรวจว่า node 9 ยังต่ออยู่กับ TextGenerateV2"
        )

    return {
        "prompt": text,
        "prompt_id": prompt_id,
        "images_used": len(image_filenames),
    }