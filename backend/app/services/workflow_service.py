"""
========================================
Workflow Service (v3 - REF2VA + T2V + Upscale Aware)
========================================
Description:
    จัดการ MiniMax H3 workflow template
    - รองรับ REF2VA (Reference to Video)
    - รองรับ T2V (Text to Video)
    - load template JSON จาก backend/workflows
    - deepcopy และแทนค่า parameterize โดยตรงใน dict
    - validate reference files สำหรับ REF2VA
    - build workflow JSON พร้อมส่งให้ ComfyUI API
    - รองรับ RelayVSR Upscale โดย detect จาก class_type
      ไม่ hardcode node ID เพราะ ComfyUI อาจ flatten subgraph
      ออกเป็น node แยก ๆ เช่น 206,207,... หรือ 173,174,...

Design notes:
    - ไม่ใช้ string replacement เพราะ prompt มี newline/quote/unicode
      การใช้ deepcopy + dict modification ปลอดภัยกว่ามาก
    - REF2VA รองรับ reference image สูงสุด 2 ช่อง
      ถ้ามี 1 ไฟล์ จะใช้ไฟล์เดียวกันซ้ำทั้งสองช่อง
    - T2V ไม่ต้องมี reference image
    - SaveVideo รองรับหลาย ID:
        172 = T2V + Upscale
        204 = REF2VA + Upscale
        92  = workflow เดิม
"""
from __future__ import annotations

import copy
import json
import random
from pathlib import Path
from typing import Any, Optional

from app.core import config

# ========================================
# Workflow types
# ========================================

WORKFLOW_REF2VA = "REF2VA"
WORKFLOW_T2V = "T2V"
DEFAULT_WORKFLOW_TYPE = WORKFLOW_REF2VA

WORKFLOW_FL2VA = "FL2VA"
# เก็บ alias เก่าไว้ กันประวัติ/payload เดิมที่บันทึกเป็น CHAIN พัง
WORKFLOW_CHAIN = WORKFLOW_FL2VA

WORKFLOW_T2V_LOW = "T2V_LOW"
WORKFLOW_FL2VA_LOW = "FL2VA_LOW"
WORKFLOW_REF2VA_LOW = "REF2VA_LOW"

WORKFLOW_TYPE_ALIASES = {
    "REF2VA": WORKFLOW_REF2VA,
    "REF2VID": WORKFLOW_REF2VA,
    "REFERENCE_TO_VIDEO": WORKFLOW_REF2VA,
    "T2V": WORKFLOW_T2V,
    "TEXT2VID": WORKFLOW_T2V,
    "TXT2VID": WORKFLOW_T2V,
    "TEXT_TO_VIDEO": WORKFLOW_T2V,
    "FL2VA": WORKFLOW_FL2VA,
    "CHAIN": WORKFLOW_FL2VA,
    "I2V": WORKFLOW_FL2VA,
    "FIRST_LAST": WORKFLOW_FL2VA,
    "T2V_LOW": WORKFLOW_T2V_LOW,
    "T2V_GGUF": WORKFLOW_T2V_LOW,
    "FL2VA_LOW": WORKFLOW_FL2VA_LOW,
    "FL2V_LOW": WORKFLOW_FL2VA_LOW,
    "FL2VA_GGUF": WORKFLOW_FL2VA_LOW,
    "REF2VA_LOW": WORKFLOW_REF2VA_LOW,
    "REF2V_LOW": WORKFLOW_REF2VA_LOW,
    "REF2VA_GGUF": WORKFLOW_REF2VA_LOW,
}

# ========================================
# Constants
# ========================================

MAX_REFERENCE_IMAGES = 2
MIN_REFERENCE_IMAGES = 1

DEFAULT_ASPECT_RATIO = "16:9 (Widescreen)"
DEFAULT_MEGAPIXELS = 0.5
DEFAULT_DURATION_SECONDS = 5.0
DEFAULT_LORA_STRENGTH = 1.0
DEFAULT_SAMPLER_NAME = "lcm"
DEFAULT_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
DEFAULT_FILENAME_PREFIX = "video/H3_Studio"

# Aspect ratios ที่ ComfyUI ResolutionSelector รับจริง
ALLOWED_ASPECT_RATIOS = {
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
}

# Upscale defaults
DEFAULT_UPSCALE_STEPS = 1
DEFAULT_UPSCALE_CFG = 1.0
DEFAULT_UPSCALE_SEED = 42
DEFAULT_UPSCALE_SAMPLER_NAME = "euler"
DEFAULT_UPSCALE_SCHEDULER = "simple"
DEFAULT_UPSCALE_UNET_NAME = "relayvsr_x2_lightx2v_int8_convrot.safetensors"
DEFAULT_UPSCALE_VAE_NAME = "relayvsr_flash_vae_x2_fp32.safetensors"

# SaveVideo candidates
NODE_SAVE_VIDEO_CANDIDATES = ("172", "204", "92")

# REF2VA node IDs
NODE_REF2VA_RESOLUTION = "115"
NODE_REF2VA_SAMPLER_SELECT = "123"
NODE_REF2VA_RANDOM_NOISE = "129"
NODE_REF2VA_DURATION = "132"
NODE_REF2VA_PROMPT = "138"
NODE_REF2VA_LORA = "145"
NODE_REF2VA_MANUAL_SIGMAS = "147"
NODE_REF2VA_LOAD_IMAGE_0 = "149"
NODE_REF2VA_LOAD_IMAGE_1 = "150"
NODE_REF2VA_MAIN_UNET_LOADER = "127"
NODE_REF2VA_MAIN_VAE_LOADERS = frozenset({"119", "120"})
NODE_REF2VA_MAIN_SAMPLER = "125"
NODE_REF2VA_MAIN_CREATE_VIDEO = "152"

# T2V node IDs
NODE_T2V_RESOLUTION = "115"
NODE_T2V_SAMPLER_SELECT = "155"
NODE_T2V_RANDOM_NOISE = "160"
NODE_T2V_DURATION = "164"
NODE_T2V_IMAGE_TO_VIDEO = "162"
NODE_T2V_LORA = "165"
NODE_T2V_MANUAL_SIGMAS = "166"
NODE_T2V_MAIN_UNET_LOADER = "158"
NODE_T2V_MAIN_VAE_LOADERS = frozenset({"151", "152"})
NODE_T2V_MAIN_SAMPLER = "156"
NODE_T2V_MAIN_CREATE_VIDEO = "161"

# Class types สำหรับ detect upscale pipeline
UPSCALE_MARKER_CLASS_TYPES = frozenset({
    "RelayVSRConditioning",
    "VSRDecode",
    "GetVideoComponents",
})

UPSCALE_CONFIGURABLE_CLASS_TYPES = frozenset({
    "KSampler",
    "UNETLoader",
    "VAELoader",
})


# ========================================
# Exceptions
# ========================================

class WorkflowTemplateError(RuntimeError):
    """
    Error เมื่อ load template ไม่สำเร็จ หรือโครงสร้าง template ผิดรูป
    """
    pass


class WorkflowValidationError(ValueError):
    """
    Error เมื่อ parameter ที่ส่งมาไม่ถูกต้อง
    """
    pass


# ========================================
# Workflow type helpers
# ========================================

def normalize_workflow_type(value: Any) -> str:
    """
    แปลง workflow type จาก frontend/backend ให้เป็นค่ามาตรฐาน

    Supported:
        REF2VA, REF2VID, REFERENCE_TO_VIDEO
        T2V, TEXT2VID, TXT2VID, TEXT_TO_VIDEO
    """
    key = str(value or "").strip().upper()
    normalized = WORKFLOW_TYPE_ALIASES.get(key)

    if normalized is None:
        raise WorkflowValidationError(
            f"workflow type ไม่รองรับ: {value}. "
            f"ค่าที่รองรับคือ {sorted(WORKFLOW_TYPE_ALIASES.keys())}"
        )

    return normalized


def _validate_aspect_ratio(aspect_ratio: str) -> str:
    """
    ตรวจสอบว่า aspect_ratio ตรงกับที่ ComfyUI ResolutionSelector รับ
    """
    value = (aspect_ratio or DEFAULT_ASPECT_RATIO).strip()

    if value not in ALLOWED_ASPECT_RATIOS:
        raise WorkflowValidationError(
            "aspect_ratio ไม่ถูกต้องสำหรับ ComfyUI ResolutionSelector. "
            f"ค่าที่รองรับคือ: {sorted(ALLOWED_ASPECT_RATIOS)}. "
            f"ได้รับ: {value}"
        )

    return value


# ========================================
# Template loading
# ========================================

def get_template_path(workflow_type: str = DEFAULT_WORKFLOW_TYPE) -> Path:
    """
    คืน path ของ workflow template ตามประเภท

    Args:
        workflow_type: REF2VA หรือ T2V

    Returns:
        Path ของไฟล์ template JSON
    """
    wt = normalize_workflow_type(workflow_type)

    if wt == WORKFLOW_T2V:
        return config.T2V_WORKFLOW_PATH

    return config.REF2VA_WORKFLOW_PATH


def load_template(workflow_type: str = DEFAULT_WORKFLOW_TYPE) -> dict[str, Any]:
    """
    โหลด workflow template จากไฟล์ JSON ตามประเภท

    Args:
        workflow_type: REF2VA หรือ T2V

    Returns:
        dict ของ workflow template

    Raises:
        WorkflowTemplateError: ถ้าไฟล์ไม่มีอยู่ อ่านไม่ได้ หรือไม่ใช่ JSON object
    """
    wt = normalize_workflow_type(workflow_type)
    template_path = get_template_path(wt)

    if not template_path.exists():
        raise WorkflowTemplateError(
            f"ไม่พบ workflow template: {template_path}. "
            f"กรุณาสร้างไฟล์ {template_path.name} ก่อน"
        )

    try:
        with template_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise WorkflowTemplateError(
            f"workflow template ไม่ใช่ JSON ที่ถูกต้อง: {exc}"
        ) from exc
    except OSError as exc:
        raise WorkflowTemplateError(
            f"อ่าน workflow template ไม่สำเร็จ: {exc}"
        ) from exc

    if not isinstance(data, dict):
        raise WorkflowTemplateError(
            "workflow template root ต้องเป็น JSON object"
        )

    return data


# ========================================
# Node helpers
# ========================================

def _get_class_type(node: Any) -> Optional[str]:
    if isinstance(node, dict):
        class_type = node.get("class_type")
        if isinstance(class_type, str):
            return class_type
    return None


def _find_save_video_node_id(template: dict[str, Any]) -> Optional[str]:
    """
    หา node SaveVideo ใน template

    Description:
        - เช็ค candidate ก่อน: 172, 204, 92
        - ถ้าไม่เจอ ให้ scan หา class_type == SaveVideo
    """
    for node_id in NODE_SAVE_VIDEO_CANDIDATES:
        if node_id in template:
            return node_id

    for node_id, node in template.items():
        if _get_class_type(node) == "SaveVideo":
            return str(node_id)

    return None


def get_save_video_node_id(workflow: dict[str, Any]) -> Optional[str]:
    """
    Public helper สำหรับ h3_service ใช้หา SaveVideo node
    """
    return _find_save_video_node_id(workflow)


def _detect_workflow_kind(workflow: dict[str, Any]) -> Optional[str]:
    """
    ตรวจว่า workflow นี้เป็น REF2VA หรือ T2V จาก class_type หลัก
    """
    for node in workflow.values():
        class_type = _get_class_type(node)

        if class_type == "MiniMaxH3ReferenceToVideo":
            return WORKFLOW_REF2VA

        if class_type == "MiniMaxH3ImageToVideo":
            return WORKFLOW_T2V

    return None


def _main_excluded_ids_for_workflow(workflow: dict[str, Any]) -> set[str]:
    """
    คืน set ของ node ID ที่เป็น main pipeline ไม่ควรนับเป็น upscale

    Description:
        ComfyUI export อาจทำให้ UNETLoader/VAELoader ของ main pipeline
        ถูก detect ผิดเป็น upscale node ได้ จึงต้อง exclude ตามชนิด workflow
    """
    kind = _detect_workflow_kind(workflow)

    if kind == WORKFLOW_T2V:
        return {
            NODE_T2V_MAIN_UNET_LOADER,
            *NODE_T2V_MAIN_VAE_LOADERS,
            NODE_T2V_MAIN_SAMPLER,
            NODE_T2V_MAIN_CREATE_VIDEO,
        }

    if kind == WORKFLOW_REF2VA:
        return {
            NODE_REF2VA_MAIN_UNET_LOADER,
            *NODE_REF2VA_MAIN_VAE_LOADERS,
            NODE_REF2VA_MAIN_SAMPLER,
            NODE_REF2VA_MAIN_CREATE_VIDEO,
        }

    # fallback: รวมทั้งสองชุด เพื่อความปลอดภัย
    return {
        NODE_REF2VA_MAIN_UNET_LOADER,
        *NODE_REF2VA_MAIN_VAE_LOADERS,
        NODE_REF2VA_MAIN_SAMPLER,
        NODE_REF2VA_MAIN_CREATE_VIDEO,
        NODE_T2V_MAIN_UNET_LOADER,
        *NODE_T2V_MAIN_VAE_LOADERS,
        NODE_T2V_MAIN_SAMPLER,
        NODE_T2V_MAIN_CREATE_VIDEO,
    }


def find_upscale_node_ids(workflow: dict[str, Any]) -> set[str]:
    """
    ค้นหา node IDs ทั้งหมดที่เป็นส่วนของ upscale pipeline

    Description:
        รองรับหลายรูปแบบ export:
        - node เดี่ยว id "205"
        - flatten subgraph id "205:2", "205:4", ...
        - flatten เป็น node แยก id เช่น 173,174,175,176,177,178,180

        ใช้ class_type เป็นหลัก และ exclude main pipeline nodes
    """
    excluded_ids = _main_excluded_ids_for_workflow(workflow)
    upscale_ids: set[str] = set()

    for node_id, node in workflow.items():
        if not isinstance(node_id, str):
            continue

        class_type = _get_class_type(node)

        if class_type in UPSCALE_MARKER_CLASS_TYPES:
            upscale_ids.add(node_id)
            continue

        if class_type in UPSCALE_CONFIGURABLE_CLASS_TYPES:
            if node_id not in excluded_ids:
                upscale_ids.add(node_id)
            continue

        if node_id.startswith("205:"):
            upscale_ids.add(node_id)

    return upscale_ids


# ========================================
# Template validation
# ========================================

def _require_object_node(
    template: dict[str, Any],
    node_id: str,
    errors: list[str],
) -> None:
    node = template.get(node_id)

    if node is None:
        errors.append(f"template ขาด node {node_id}")
        return

    if not isinstance(node, dict):
        errors.append(f"node {node_id} ต้องเป็น object")
        return

    if "inputs" not in node or not isinstance(node["inputs"], dict):
        errors.append(f"node {node_id} ขาด inputs object")


def validate_template_structure(
    template: dict[str, Any],
    workflow_type: str = DEFAULT_WORKFLOW_TYPE,
) -> list[str]:
    """
    ตรวจสอบว่า template มี node จำเป็นครบ ตามประเภท workflow
    """
    wt = normalize_workflow_type(workflow_type)
    errors: list[str] = []

    if wt == WORKFLOW_T2V:
        required_core_nodes = [
            NODE_T2V_RESOLUTION,
            NODE_T2V_SAMPLER_SELECT,
            NODE_T2V_RANDOM_NOISE,
            NODE_T2V_DURATION,
            NODE_T2V_IMAGE_TO_VIDEO,
            NODE_T2V_LORA,
            NODE_T2V_MANUAL_SIGMAS,
        ]
    else:
        required_core_nodes = [
            NODE_REF2VA_RESOLUTION,
            NODE_REF2VA_SAMPLER_SELECT,
            NODE_REF2VA_RANDOM_NOISE,
            NODE_REF2VA_DURATION,
            NODE_REF2VA_PROMPT,
            NODE_REF2VA_LORA,
            NODE_REF2VA_MANUAL_SIGMAS,
            NODE_REF2VA_LOAD_IMAGE_0,
        ]

    for node_id in required_core_nodes:
        _require_object_node(template, node_id, errors)

    # REF2VA: node 150 เป็น optional แต่ถ้ามีต้องถูกต้อง
    if wt == WORKFLOW_REF2VA and NODE_REF2VA_LOAD_IMAGE_1 in template:
        _require_object_node(template, NODE_REF2VA_LOAD_IMAGE_1, errors)

    # ต้องมี SaveVideo อย่างน้อย 1 ตัว
    save_video_node_id = _find_save_video_node_id(template)

    if save_video_node_id is None:
        errors.append(
            "template ต้องมี node SaveVideo อย่างน้อย 1 ตัว "
            "(172 สำหรับ T2V+Upscale, 204 สำหรับ REF2VA+Upscale, หรือ 92 สำหรับเวอร์ชันเดิม)"
        )
    else:
        _require_object_node(template, save_video_node_id, errors)

    # Validate upscale nodes ถ้ามี
    upscale_ids = find_upscale_node_ids(template)

    for node_id in upscale_ids:
        node = template.get(node_id)

        if not isinstance(node, dict):
            errors.append(f"upscale node {node_id} ต้องเป็น object")
            continue

        if "inputs" in node and not isinstance(node["inputs"], dict):
            errors.append(f"upscale node {node_id} inputs ต้องเป็น object")

    return errors


# ========================================
# Reference validation
# ========================================

def validate_reference_files(reference_filenames: list[str]) -> dict[str, Any]:
    """
    ตรวจสอบว่า reference files มีอยู่ใน ComfyUI/input จริง

    Description:
        ComfyUI LoadImage ต้องการ filename เท่านั้น และไฟล์ต้องอยู่ใน input directory
        ถ้าไฟล์ไม่มีอยู่ ComfyUI จะ error ตอนรัน ดังนั้น validate ก่อน build workflow

    Args:
        reference_filenames: รายการ stored_filename จาก upload API

    Returns:
        dict containing:
            - valid: bool
            - count: int
            - checked: list of {filename, exists, path}
            - errors: list of message

    Raises:
        WorkflowValidationError: ถ้าจำนวน reference ไม่ถูกต้อง
    """
    if not reference_filenames:
        raise WorkflowValidationError(
            f"REF2VA ต้องมี reference image อย่างน้อย {MIN_REFERENCE_IMAGES} ไฟล์"
        )

    if len(reference_filenames) > MAX_REFERENCE_IMAGES:
        raise WorkflowValidationError(
            f"workflow ปัจจุบันรองรับ reference image สูงสุด {MAX_REFERENCE_IMAGES} ไฟล์ "
            f"(ได้รับ {len(reference_filenames)} ไฟล์)"
        )

        # โหมด remote: ไฟล์อยู่บน ComfyUI ปลายทาง ไม่ใช่ filesystem เครื่องนี้
    # จึงข้ามการตรวจ local path (upload API ยืนยันแล้วว่ารันสำเร็จ)
    if getattr(config, "COMFYUI_IS_REMOTE", False):
        checked = [
            {
                "filename": Path(name).name,
                "exists": True,
                "path": f"comfyui-input:{Path(name).name}",
                "remote": True,
            }
            for name in reference_filenames
        ]
        return {
            "valid": True,
            "count": len(reference_filenames),
            "checked": checked,
            "errors": [],
            "remote": True,
        }


    input_dir = config.COMFYUI_INPUT_DIR
    checked: list[dict[str, Any]] = []
    errors: list[str] = []

    for filename in reference_filenames:
        clean_name = Path(filename).name
        file_path = input_dir / clean_name
        exists = file_path.exists() and file_path.is_file()

        checked.append({
            "filename": clean_name,
            "exists": exists,
            "path": str(file_path),
        })

        if not exists:
            errors.append(f"ไม่พบ reference file ใน ComfyUI/input: {clean_name}")

    return {
        "valid": len(errors) == 0,
        "count": len(reference_filenames),
        "checked": checked,
        "errors": errors,
    }


# ========================================
# Workflow building helpers
# ========================================

def _normalize_seed(seed: int | None) -> int:
    """
    แปลง seed ให้เป็น int ที่ใช้ได้กับ ComfyUI RandomNoise

    Description:
        - ถ้า seed = -1 หรือ None จะสุ่ม seed ใหม่
        - ComfyUI RandomNoise ใช้ noise_seed เป็น integer
        - สุ่มในช่วงที่ปลอดภัยสำหรับ int64
    """
    if seed is None or seed < 0:
        return random.randint(1, 2**63 - 1)

    return int(seed)


def _normalize_duration(duration: float | int | None) -> float:
    """
    ตรวจสอบและปรับ duration ให้อยู่ในช่วงที่ workflow รองรับ
    """
    if duration is None:
        return DEFAULT_DURATION_SECONDS

    value = float(duration)

    if value < DEFAULT_DURATION_SECONDS:
        return DEFAULT_DURATION_SECONDS

    if value > 30.0:
        return 30.0

    return value


def _normalize_megapixels(megapixels: float | int | None) -> float:
    """
    ปรับ megapixels ให้อยู่ในช่วงปลอดภัย
    """
    if megapixels is None:
        return DEFAULT_MEGAPIXELS

    value = float(megapixels)

    if value <= 0:
        return DEFAULT_MEGAPIXELS

    if value > 2.0:
        return 2.0

    return value


def _normalize_lora_strength(strength: float | int | None) -> float:
    """
    ปรับ LoRA strength ให้อยู่ในช่วง 0-2
    """
    if strength is None:
        return DEFAULT_LORA_STRENGTH

    value = float(strength)

    if value < 0:
        return 0.0

    if value > 2.0:
        return 2.0

    return value


def _prepare_reference_filenames(reference_filenames: list[str]) -> list[str]:
    """
    เตรียม reference filenames สำหรับ workflow 2 ช่อง
    """
    cleaned = [Path(name).name for name in reference_filenames]

    if len(cleaned) == 1:
        return [cleaned[0], cleaned[0]]

    if len(cleaned) == 2:
        return [cleaned[0], cleaned[1]]

    raise WorkflowValidationError(
        f"จำนวน reference ต้องเป็น {MIN_REFERENCE_IMAGES} หรือ {MAX_REFERENCE_IMAGES}"
    )


def _find_save_video_node(
    workflow: dict[str, Any],
) -> tuple[Optional[str], Optional[dict[str, Any]]]:
    """
    หา node SaveVideo ใน workflow
    """
    node_id = _find_save_video_node_id(workflow)

    if node_id is None:
        return None, None

    node = workflow.get(node_id)

    if isinstance(node, dict):
        return node_id, node

    return None, None


def _apply_upscale_settings(
    workflow: dict[str, Any],
    upscale_seed: int,
) -> None:
    """
    ตั้งค่า node RelayVSR Upscaler ถ้ามีอยู่ใน workflow

    Description:
        รองรับทั้ง:
        - node เดี่ยวชื่อ 205
        - flatten subgraph เช่น 205:2, 205:4, ...
        - node แยก เช่น 173,174,175,176,177,178,180

        จะตั้งค่าเฉพาะ node ที่รู้จัก class_type:
        - KSampler: seed, steps, cfg, sampler_name, scheduler
        - UNETLoader: unet_name
        - VAELoader: vae_name
    """
    upscale_ids = find_upscale_node_ids(workflow)

    for node_id in upscale_ids:
        node = workflow.get(node_id)

        if not isinstance(node, dict):
            continue

        inputs = node.get("inputs")

        if not isinstance(inputs, dict):
            inputs = {}
            node["inputs"] = inputs

        class_type = _get_class_type(node)

        if class_type == "KSampler":
            inputs["steps"] = int(DEFAULT_UPSCALE_STEPS)
            inputs["cfg"] = float(DEFAULT_UPSCALE_CFG)
            inputs["seed"] = int(upscale_seed)
            inputs["sampler_name"] = DEFAULT_UPSCALE_SAMPLER_NAME
            inputs["scheduler"] = DEFAULT_UPSCALE_SCHEDULER

        elif class_type == "UNETLoader":
            inputs["unet_name"] = DEFAULT_UPSCALE_UNET_NAME

        elif class_type == "VAELoader":
            inputs["vae_name"] = DEFAULT_UPSCALE_VAE_NAME


# ========================================
# Build REF2VA workflow
# ========================================

def build_ref2va_workflow(
    prompt: str,
    reference_filenames: list[str],
    seed: int | None = -1,
    duration: float | int | None = DEFAULT_DURATION_SECONDS,
    aspect_ratio: str | None = DEFAULT_ASPECT_RATIO,
    megapixels: float | int | None = DEFAULT_MEGAPIXELS,
    lora_strength: float | int | None = DEFAULT_LORA_STRENGTH,
    sampler_name: str | None = DEFAULT_SAMPLER_NAME,
    sigmas: str | None = DEFAULT_SIGMAS,
    filename_prefix: str | None = DEFAULT_FILENAME_PREFIX,
) -> dict[str, Any]:
    """
    สร้าง REF2VA workflow JSON พร้อมส่งให้ ComfyUI
    """
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")

    template = load_template(WORKFLOW_REF2VA)

    structure_errors = validate_template_structure(template, WORKFLOW_REF2VA)
    if structure_errors:
        raise WorkflowTemplateError(
            "workflow template ผิดโครงสร้าง: " + "; ".join(structure_errors)
        )

    ref_validation = validate_reference_files(reference_filenames)
    if not ref_validation["valid"]:
        raise WorkflowValidationError(
            "reference file validation ล้มเหลว: " + "; ".join(ref_validation["errors"])
        )

    workflow = copy.deepcopy(template)

    prepared_refs = _prepare_reference_filenames(reference_filenames)
    real_seed = _normalize_seed(seed)
    real_duration = _normalize_duration(duration)
    real_megapixels = _normalize_megapixels(megapixels)
    real_lora_strength = _normalize_lora_strength(lora_strength)
    real_aspect_ratio = _validate_aspect_ratio(aspect_ratio)
    real_sampler = (sampler_name or DEFAULT_SAMPLER_NAME).strip()
    real_sigmas = (sigmas or DEFAULT_SIGMAS).strip()
    real_prefix = (filename_prefix or DEFAULT_FILENAME_PREFIX).strip()

    # Prompt
    prompt_node = workflow.get(NODE_REF2VA_PROMPT)
    if not isinstance(prompt_node, dict):
        raise WorkflowTemplateError(f"template ขาด node prompt: {NODE_REF2VA_PROMPT}")

    prompt_inputs = prompt_node.setdefault("inputs", {})
    if not isinstance(prompt_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_REF2VA_PROMPT} inputs ต้องเป็น object")

    prompt_inputs["value"] = prompt

    # Seed
    noise_node = workflow.get(NODE_REF2VA_RANDOM_NOISE)
    if not isinstance(noise_node, dict):
        raise WorkflowTemplateError(f"template ขาด node random noise: {NODE_REF2VA_RANDOM_NOISE}")

    noise_inputs = noise_node.setdefault("inputs", {})
    if not isinstance(noise_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_REF2VA_RANDOM_NOISE} inputs ต้องเป็น object")

    noise_inputs["noise_seed"] = real_seed

    # Duration
    duration_node = workflow.get(NODE_REF2VA_DURATION)
    if not isinstance(duration_node, dict):
        raise WorkflowTemplateError(f"template ขาด node duration: {NODE_REF2VA_DURATION}")

    duration_inputs = duration_node.setdefault("inputs", {})
    if not isinstance(duration_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_REF2VA_DURATION} inputs ต้องเป็น object")

    duration_inputs["value"] = real_duration

    # Resolution
    resolution_node = workflow.get(NODE_REF2VA_RESOLUTION)
    if not isinstance(resolution_node, dict):
        raise WorkflowTemplateError(f"template ขาด node resolution: {NODE_REF2VA_RESOLUTION}")

    resolution_inputs = resolution_node.setdefault("inputs", {})
    if not isinstance(resolution_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_REF2VA_RESOLUTION} inputs ต้องเป็น object")

    resolution_inputs["aspect_ratio"] = real_aspect_ratio
    resolution_inputs["megapixels"] = real_megapixels

    # Reference images
    load_image_0 = workflow.get(NODE_REF2VA_LOAD_IMAGE_0)
    if not isinstance(load_image_0, dict):
        raise WorkflowTemplateError(
            f"template ขาด node LoadImage ตัวที่ 1: {NODE_REF2VA_LOAD_IMAGE_0}"
        )

    load_image_0_inputs = load_image_0.setdefault("inputs", {})
    if not isinstance(load_image_0_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_REF2VA_LOAD_IMAGE_0} inputs ต้องเป็น object"
        )

    load_image_0_inputs["image"] = prepared_refs[0]

    load_image_1 = workflow.get(NODE_REF2VA_LOAD_IMAGE_1)

    if len(reference_filenames) >= 2:
        if not isinstance(load_image_1, dict):
            raise WorkflowTemplateError(
                f"template ขาด node LoadImage ตัวที่ 2: {NODE_REF2VA_LOAD_IMAGE_1} "
                "ไม่สามารถใช้ reference 2 ไฟล์ได้"
            )

        load_image_1_inputs = load_image_1.setdefault("inputs", {})
        if not isinstance(load_image_1_inputs, dict):
            raise WorkflowTemplateError(
                f"node {NODE_REF2VA_LOAD_IMAGE_1} inputs ต้องเป็น object"
            )

        load_image_1_inputs["image"] = prepared_refs[1]
    else:
        if isinstance(load_image_1, dict):
            load_image_1_inputs = load_image_1.setdefault("inputs", {})
            if isinstance(load_image_1_inputs, dict):
                load_image_1_inputs["image"] = prepared_refs[0]

    # LoRA
    lora_node = workflow.get(NODE_REF2VA_LORA)
    if not isinstance(lora_node, dict):
        raise WorkflowTemplateError(f"template ขาด node LoRA: {NODE_REF2VA_LORA}")

    lora_inputs = lora_node.setdefault("inputs", {})
    if not isinstance(lora_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_REF2VA_LORA} inputs ต้องเป็น object")

    lora_inputs["strength_model"] = real_lora_strength

    # Sampler
    sampler_node = workflow.get(NODE_REF2VA_SAMPLER_SELECT)
    if not isinstance(sampler_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node sampler select: {NODE_REF2VA_SAMPLER_SELECT}"
        )

    sampler_inputs = sampler_node.setdefault("inputs", {})
    if not isinstance(sampler_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_REF2VA_SAMPLER_SELECT} inputs ต้องเป็น object"
        )

    sampler_inputs["sampler_name"] = real_sampler

    # Sigmas
    sigmas_node = workflow.get(NODE_REF2VA_MANUAL_SIGMAS)
    if not isinstance(sigmas_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node manual sigmas: {NODE_REF2VA_MANUAL_SIGMAS}"
        )

    sigmas_inputs = sigmas_node.setdefault("inputs", {})
    if not isinstance(sigmas_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_REF2VA_MANUAL_SIGMAS} inputs ต้องเป็น object"
        )

    sigmas_inputs["sigmas"] = real_sigmas

    # Save prefix
    save_video_node_id, save_video_node = _find_save_video_node(workflow)

    if save_video_node is None:
        raise WorkflowTemplateError(
            "ไม่พบ node SaveVideo ใน workflow template "
            "(ต้องมี 172 สำหรับ T2V+Upscale, 204 สำหรับ REF2VA+Upscale หรือ 92 สำหรับเวอร์ชันเดิม)"
        )

    save_video_inputs = save_video_node.setdefault("inputs", {})
    if not isinstance(save_video_inputs, dict):
        raise WorkflowTemplateError(
            f"node {save_video_node_id} inputs ต้องเป็น object"
        )

    save_video_inputs["filename_prefix"] = real_prefix

    # Upscale
    effective_upscale_seed = (
        real_seed if seed is not None and seed >= 0 else DEFAULT_UPSCALE_SEED
    )

    _apply_upscale_settings(
        workflow=workflow,
        upscale_seed=effective_upscale_seed,
    )

    return workflow


# ========================================
# Build T2V workflow
# ========================================

def build_t2v_workflow(
    prompt: str,
    seed: int | None = -1,
    duration: float | int | None = DEFAULT_DURATION_SECONDS,
    aspect_ratio: str | None = DEFAULT_ASPECT_RATIO,
    megapixels: float | int | None = DEFAULT_MEGAPIXELS,
    lora_strength: float | int | None = DEFAULT_LORA_STRENGTH,
    sampler_name: str | None = DEFAULT_SAMPLER_NAME,
    sigmas: str | None = DEFAULT_SIGMAS,
    filename_prefix: str | None = DEFAULT_FILENAME_PREFIX,
) -> dict[str, Any]:
    """
    สร้าง T2V workflow JSON พร้อมส่งให้ ComfyUI

    Description:
        T2V ไม่มี reference image
        prompt ถูกใส่เข้าไปใน node 162 (MiniMaxH3ImageToVideo) โดยตรง
    """
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")

    template = load_template(WORKFLOW_T2V)

    structure_errors = validate_template_structure(template, WORKFLOW_T2V)
    if structure_errors:
        raise WorkflowTemplateError(
            "workflow template ผิดโครงสร้าง: " + "; ".join(structure_errors)
        )

    workflow = copy.deepcopy(template)

    real_seed = _normalize_seed(seed)
    real_duration = _normalize_duration(duration)
    real_megapixels = _normalize_megapixels(megapixels)
    real_lora_strength = _normalize_lora_strength(lora_strength)
    real_aspect_ratio = _validate_aspect_ratio(aspect_ratio)
    real_sampler = (sampler_name or DEFAULT_SAMPLER_NAME).strip()
    real_sigmas = (sigmas or DEFAULT_SIGMAS).strip()
    real_prefix = (filename_prefix or DEFAULT_FILENAME_PREFIX).strip()

    # Prompt inside MiniMaxH3ImageToVideo node 162
    image_to_video_node = workflow.get(NODE_T2V_IMAGE_TO_VIDEO)
    if not isinstance(image_to_video_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node image to video: {NODE_T2V_IMAGE_TO_VIDEO}"
        )

    image_to_video_inputs = image_to_video_node.setdefault("inputs", {})
    if not isinstance(image_to_video_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_IMAGE_TO_VIDEO} inputs ต้องเป็น object"
        )

    image_to_video_inputs["prompt"] = prompt

    # Seed
    noise_node = workflow.get(NODE_T2V_RANDOM_NOISE)
    if not isinstance(noise_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node random noise: {NODE_T2V_RANDOM_NOISE}"
        )

    noise_inputs = noise_node.setdefault("inputs", {})
    if not isinstance(noise_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_RANDOM_NOISE} inputs ต้องเป็น object"
        )

    noise_inputs["noise_seed"] = real_seed

    # Duration
    duration_node = workflow.get(NODE_T2V_DURATION)
    if not isinstance(duration_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node duration: {NODE_T2V_DURATION}"
        )

    duration_inputs = duration_node.setdefault("inputs", {})
    if not isinstance(duration_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_DURATION} inputs ต้องเป็น object"
        )

    duration_inputs["value"] = real_duration

    # Resolution
    resolution_node = workflow.get(NODE_T2V_RESOLUTION)
    if not isinstance(resolution_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node resolution: {NODE_T2V_RESOLUTION}"
        )

    resolution_inputs = resolution_node.setdefault("inputs", {})
    if not isinstance(resolution_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_RESOLUTION} inputs ต้องเป็น object"
        )

    resolution_inputs["aspect_ratio"] = real_aspect_ratio
    resolution_inputs["megapixels"] = real_megapixels

    # LoRA
    lora_node = workflow.get(NODE_T2V_LORA)
    if not isinstance(lora_node, dict):
        raise WorkflowTemplateError(f"template ขาด node LoRA: {NODE_T2V_LORA}")

    lora_inputs = lora_node.setdefault("inputs", {})
    if not isinstance(lora_inputs, dict):
        raise WorkflowTemplateError(f"node {NODE_T2V_LORA} inputs ต้องเป็น object")

    lora_inputs["strength_model"] = real_lora_strength

    # Sampler
    sampler_node = workflow.get(NODE_T2V_SAMPLER_SELECT)
    if not isinstance(sampler_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node sampler select: {NODE_T2V_SAMPLER_SELECT}"
        )

    sampler_inputs = sampler_node.setdefault("inputs", {})
    if not isinstance(sampler_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_SAMPLER_SELECT} inputs ต้องเป็น object"
        )

    sampler_inputs["sampler_name"] = real_sampler

    # Sigmas
    sigmas_node = workflow.get(NODE_T2V_MANUAL_SIGMAS)
    if not isinstance(sigmas_node, dict):
        raise WorkflowTemplateError(
            f"template ขาด node manual sigmas: {NODE_T2V_MANUAL_SIGMAS}"
        )

    sigmas_inputs = sigmas_node.setdefault("inputs", {})
    if not isinstance(sigmas_inputs, dict):
        raise WorkflowTemplateError(
            f"node {NODE_T2V_MANUAL_SIGMAS} inputs ต้องเป็น object"
        )

    sigmas_inputs["sigmas"] = real_sigmas

    # Save prefix
    save_video_node_id, save_video_node = _find_save_video_node(workflow)

    if save_video_node is None:
        raise WorkflowTemplateError(
            "ไม่พบ node SaveVideo ใน workflow template T2V "
            "(ควรเป็น node 172 สำหรับเวอร์ชันที่มี Upscale)"
        )

    save_video_inputs = save_video_node.setdefault("inputs", {})
    if not isinstance(save_video_inputs, dict):
        raise WorkflowTemplateError(
            f"node {save_video_node_id} inputs ต้องเป็น object"
        )

    save_video_inputs["filename_prefix"] = real_prefix

    # Upscale
    effective_upscale_seed = (
        real_seed if seed is not None and seed >= 0 else DEFAULT_UPSCALE_SEED
    )

    _apply_upscale_settings(
        workflow=workflow,
        upscale_seed=effective_upscale_seed,
    )

    return workflow


# ========================================
# Template info
# ========================================

def get_template_info(workflow_type: str = DEFAULT_WORKFLOW_TYPE) -> dict[str, Any]:
    """
    คืนข้อมูล template สำหรับ debug/UI
    """
    wt = normalize_workflow_type(workflow_type)
    template_path = get_template_path(wt)
    exists = template_path.exists()

    structure_errors: list[str] = []
    output_node_id: Optional[str] = None
    upscale_node_ids: list[str] = []

    if exists:
        try:
            template = load_template(wt)
            structure_errors = validate_template_structure(template, wt)
            output_node_id = _find_save_video_node_id(template)
            upscale_node_ids = sorted(find_upscale_node_ids(template))
        except WorkflowTemplateError as exc:
            structure_errors = [str(exc)]

    return {
        "workflow_type": wt,
        "template_path": str(template_path),
        "template_exists": exists,
        "structure_errors": structure_errors,
        "output_node_id": output_node_id,
        "upscale_node_ids": upscale_node_ids,
        "upscale_node_present": len(upscale_node_ids) > 0,
        "defaults": {
            "aspect_ratio": DEFAULT_ASPECT_RATIO,
            "megapixels": DEFAULT_MEGAPIXELS,
            "duration_seconds": DEFAULT_DURATION_SECONDS,
            "lora_strength": DEFAULT_LORA_STRENGTH,
            "sampler_name": DEFAULT_SAMPLER_NAME,
            "sigmas": DEFAULT_SIGMAS,
            "filename_prefix": DEFAULT_FILENAME_PREFIX,
            "upscale": {
                "steps": DEFAULT_UPSCALE_STEPS,
                "cfg": DEFAULT_UPSCALE_CFG,
                "seed": DEFAULT_UPSCALE_SEED,
                "sampler_name": DEFAULT_UPSCALE_SAMPLER_NAME,
                "scheduler": DEFAULT_UPSCALE_SCHEDULER,
                "unet_name": DEFAULT_UPSCALE_UNET_NAME,
                "vae_name": DEFAULT_UPSCALE_VAE_NAME,
            },
        },
        "limits": {
            "min_reference_images": MIN_REFERENCE_IMAGES,
            "max_reference_images": MAX_REFERENCE_IMAGES,
            "max_duration_seconds": 30.0,
            "max_megapixels": 2.0,
            "max_lora_strength": 2.0,
        },
        "comfyui_input_dir": str(config.COMFYUI_INPUT_DIR),
    }

# ========================================
# Build FL2VA workflow (first/last frame -> video)
# ========================================

def _inject_load_image(
    workflow: dict[str, Any],
    filename: str,
    start_id: str,
) -> str:
    """
    เพิ่ม LoadImage node ใหม่เข้า workflow โดยเลือก id ที่ว่าง
    """
    node_id = start_id
    while node_id in workflow:
        node_id = str(int(node_id) + 1)

    workflow[node_id] = {
        "inputs": {"image": Path(filename).name},
        "class_type": "LoadImage",
    }
    return node_id


def _ensure_frame_available(filename: str) -> None:
    """
    ตรวจว่าไฟล์เฟรมมีอยู่ใน ComfyUI input (เฉพาะ local mode)
    """
    clean = Path(str(filename).strip()).name

    if getattr(config, "COMFYUI_IS_REMOTE", False):
        return

    if not (config.COMFYUI_INPUT_DIR / clean).exists():
        raise WorkflowValidationError(f"ไม่พบไฟล์เฟรมใน ComfyUI/input: {clean}")


def build_fl2va_workflow(
    prompt: str,
    first_frame_filename: str | None = None,
    last_frame_filename: str | None = None,
    seed: int | None = -1,
    duration: float | int | None = DEFAULT_DURATION_SECONDS,
    aspect_ratio: str | None = DEFAULT_ASPECT_RATIO,
    megapixels: float | int | None = DEFAULT_MEGAPIXELS,
    lora_strength: float | int | None = DEFAULT_LORA_STRENGTH,
    sampler_name: str | None = DEFAULT_SAMPLER_NAME,
    sigmas: str | None = DEFAULT_SIGMAS,
    filename_prefix: str | None = DEFAULT_FILENAME_PREFIX,
) -> dict[str, Any]:
    """
    สร้าง workflow FL2VA (First/Last frame to Video)

    Description:
        ใช้ T2V template เป็นฐาน (checkpoint fl2va เดิม) แล้ว inject LoadImage:
        - first_frame → node 900 (เริ่มคลิปจากภาพนี้ / ต่อคลิป)
        - last_frame  → node 901 (จบคลิปที่ภาพนี้)
        - ใส่ทั้งคู่  → interpolation A→B (transition เนียนระหว่างสองฉาก)
    """
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")

    has_first = bool(first_frame_filename and str(first_frame_filename).strip())
    has_last = bool(last_frame_filename and str(last_frame_filename).strip())

    if not has_first and not has_last:
        raise WorkflowValidationError(
            "FL2VA ต้องมี first frame หรือ last frame อย่างน้อย 1 รูป"
        )

    workflow = build_t2v_workflow(
        prompt=prompt,
        seed=seed,
        duration=duration,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        lora_strength=lora_strength,
        sampler_name=sampler_name,
        sigmas=sigmas,
        filename_prefix=filename_prefix,
    )

    target = workflow.get(NODE_T2V_IMAGE_TO_VIDEO)
    if not isinstance(target, dict):
        raise WorkflowTemplateError(
            f"ไม่พบ node {NODE_T2V_IMAGE_TO_VIDEO} ใน FL2VA workflow"
        )

    inputs = target.setdefault("inputs", {})

    if has_first:
        _ensure_frame_available(first_frame_filename)
        first_id = _inject_load_image(workflow, first_frame_filename, "900")
        inputs["first_frame"] = [first_id, 0]

    if has_last:
        _ensure_frame_available(last_frame_filename)
        last_id = _inject_load_image(workflow, last_frame_filename, "901")
        inputs["last_frame"] = [last_id, 0]

    return workflow

# ========================================
# GGUF (Low VRAM) templates & builders
# ========================================
import random as _gguf_random

_GGUF_TEMPLATE_DIR = Path(__file__).resolve().parent.parent.parent / "workflows"

# --- node ids: T2V GGUF ---
NODE_GGUF_T2V_PROMPT = "217"
NODE_GGUF_T2V_SEED = "215"
NODE_GGUF_T2V_DURATION = "219"
NODE_GGUF_T2V_RESOLUTION = "115"
NODE_GGUF_T2V_SAVE = "204"

# --- node ids: FL2VA GGUF ---
NODE_GGUF_FL2VA_PROMPT = "215"
NODE_GGUF_FL2VA_FIRST_FRAME = "148"
NODE_GGUF_FL2VA_SEED = "213"
NODE_GGUF_FL2VA_DURATION = "217"
NODE_GGUF_FL2VA_RESOLUTION = "154"
NODE_GGUF_FL2VA_SAVE = "205"

# --- node ids: REF2VA GGUF ---
NODE_GGUF_REF2VA_PROMPT = "138"
NODE_GGUF_REF2VA_NODE = "136"
NODE_GGUF_REF2VA_REF0 = "149"
NODE_GGUF_REF2VA_REF1 = "150"
NODE_GGUF_REF2VA_SEED = "129"
NODE_GGUF_REF2VA_DURATION = "132"
NODE_GGUF_REF2VA_RESOLUTION = "115"
NODE_GGUF_REF2VA_SAVE = "204"


def _load_gguf_template(filename: str) -> dict:
    path = _GGUF_TEMPLATE_DIR / filename
    if not path.exists():
        raise WorkflowTemplateError(f"ไม่พบ GGUF template: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _gguf_resolve_seed(seed) -> int:
    try:
        s = int(seed)
    except (TypeError, ValueError):
        s = -1
    if s < 0:
        return _gguf_random.randint(0, 2**53 - 1)
    return s


def _gguf_resolve_duration(duration) -> float:
    try:
        d = float(duration)
    except (TypeError, ValueError):
        d = 5.0
    return max(5.0, min(30.0, d))


def build_t2v_gguf_workflow(
    prompt, seed=-1, duration=5, aspect_ratio="16:9 (Widescreen)",
    megapixels=0.5, filename_prefix="video/H3_Studio_T2V_LOW",
):
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")

    wf = _load_gguf_template("minimax_h3_t2v_gguf.api.json")
    wf[NODE_GGUF_T2V_PROMPT]["inputs"]["prompt"] = prompt.strip()
    wf[NODE_GGUF_T2V_SEED]["inputs"]["noise_seed"] = _gguf_resolve_seed(seed)
    wf[NODE_GGUF_T2V_DURATION]["inputs"]["value"] = _gguf_resolve_duration(duration)
    wf[NODE_GGUF_T2V_RESOLUTION]["inputs"]["aspect_ratio"] = aspect_ratio
    wf[NODE_GGUF_T2V_RESOLUTION]["inputs"]["megapixels"] = megapixels
    wf[NODE_GGUF_T2V_SAVE]["inputs"]["filename_prefix"] = filename_prefix
    return wf


def build_fl2va_gguf_workflow(
    prompt, first_frame_filename, seed=-1, duration=5,
    aspect_ratio="16:9 (Widescreen)", megapixels=0.5,
    filename_prefix="video/H3_Studio_FL2VA_LOW",
):
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")
    if not first_frame_filename:
        raise WorkflowValidationError("FL2VA (Low VRAM) ต้องมี first frame")

    wf = _load_gguf_template("minimax_h3_fl2va_gguf.api.json")
    wf[NODE_GGUF_FL2VA_PROMPT]["inputs"]["prompt"] = prompt.strip()
    wf[NODE_GGUF_FL2VA_FIRST_FRAME]["inputs"]["image"] = Path(first_frame_filename).name
    wf[NODE_GGUF_FL2VA_SEED]["inputs"]["noise_seed"] = _gguf_resolve_seed(seed)
    wf[NODE_GGUF_FL2VA_DURATION]["inputs"]["value"] = _gguf_resolve_duration(duration)
    wf[NODE_GGUF_FL2VA_RESOLUTION]["inputs"]["aspect_ratio"] = aspect_ratio
    wf[NODE_GGUF_FL2VA_RESOLUTION]["inputs"]["megapixels"] = megapixels
    wf[NODE_GGUF_FL2VA_SAVE]["inputs"]["filename_prefix"] = filename_prefix
    return wf


def build_ref2va_gguf_workflow(
    prompt, reference_filenames, seed=-1, duration=5,
    aspect_ratio="16:9 (Widescreen)", megapixels=0.5,
    filename_prefix="video/H3_Studio_REF2VA_LOW",
):
    if not prompt or not prompt.strip():
        raise WorkflowValidationError("prompt ห้ามว่างเปล่า")

    refs = [Path(r).name for r in (reference_filenames or []) if r]
    if not refs:
        raise WorkflowValidationError("REF2VA (Low VRAM) ต้องมี reference อย่างน้อย 1 รูป")

    wf = _load_gguf_template("minimax_h3_ref2va_gguf.api.json")
    wf[NODE_GGUF_REF2VA_PROMPT]["inputs"]["value"] = prompt.strip()

    wf[NODE_GGUF_REF2VA_REF0]["inputs"]["image"] = refs[0]
    if len(refs) >= 2:
        wf[NODE_GGUF_REF2VA_REF1]["inputs"]["image"] = refs[1]
    else:
        wf[NODE_GGUF_REF2VA_NODE]["inputs"].pop("ref_images.ref_image_1", None)
        wf.pop(NODE_GGUF_REF2VA_REF1, None)

    wf[NODE_GGUF_REF2VA_SEED]["inputs"]["noise_seed"] = _gguf_resolve_seed(seed)
    wf[NODE_GGUF_REF2VA_DURATION]["inputs"]["value"] = _gguf_resolve_duration(duration)
    wf[NODE_GGUF_REF2VA_RESOLUTION]["inputs"]["aspect_ratio"] = aspect_ratio
    wf[NODE_GGUF_REF2VA_RESOLUTION]["inputs"]["megapixels"] = megapixels
    wf[NODE_GGUF_REF2VA_SAVE]["inputs"]["filename_prefix"] = filename_prefix
    return wf