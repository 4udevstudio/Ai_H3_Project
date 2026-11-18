"""
========================================
Workflows Router
========================================
Description:
    API สำหรับทดสอบและตรวจสอบ workflow template
    ยังไม่ยิง ComfyUI ในขั้นตอนนี้

Endpoints:
    GET  /api/workflows/ref2va/template : ดูข้อมูล template และ default values
    POST /api/workflows/ref2va/build    : build workflow JSON จาก parameters + validate references

Notes:
    - ใช้สำหรับ verify โครงสร้างก่อนต่อ ComfyUI client ใน STEP 8.4
    - build endpoint จะคืน workflow JSON ที่พร้อมส่งให้ ComfyUI /prompt
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.workflow_service import (
    WorkflowTemplateError,
    WorkflowValidationError,
    build_ref2va_workflow,
    get_template_info,
)

router = APIRouter()


class BuildWorkflowRequest(BaseModel):
    """
    Request body สำหรับ build REF2VA workflow

    Fields:
        prompt: prompt หลัก
        reference_filenames: stored_filename จาก upload API (1-2 ไฟล์)
        seed: seed (-1 = สุ่ม)
        duration: ความยาววินาที
        aspect_ratio: อัตราส่วนภาพ
        megapixels: ขนาดภาพ
        lora_strength: ความแรง LoRA
        sampler_name: ชื่อ sampler
        sigmas: sigmas string
        filename_prefix: prefix ไฟล์ผลลัพธ์
    """
    prompt: str = Field(..., min_length=1, description="prompt หลัก")
    reference_filenames: list[str] = Field(
        ...,
        min_length=1,
        max_length=2,
        description="stored_filename จาก upload API (1-2 ไฟล์)",
    )
    seed: int = Field(-1, description="seed, -1 = สุ่ม")
    duration: float = Field(5.0, ge=5.0, le=30.0, description="ความยาววินาที")
    aspect_ratio: Optional[str] = Field("16:9 (Widescreen)", description="อัตราส่วนภาพ")
    megapixels: float = Field(1.0, ge=0.1, le=2.0, description="ขนาดภาพ")
    lora_strength: float = Field(1.0, ge=0.0, le=2.0, description="ความแรง LoRA")
    sampler_name: Optional[str] = Field("lcm", description="ชื่อ sampler")
    sigmas: Optional[str] = Field(
        "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0",
        description="sigmas string",
    )
    filename_prefix: Optional[str] = Field(
        "video/H3_Studio",
        description="prefix ไฟล์ผลลัพธ์",
    )


@router.get("/ref2va/template", summary="ดูข้อมูล REF2VA workflow template")
def template_info() -> dict[str, Any]:
    """
    คืนข้อมูล template สำหรับ debug

    Returns:
        dict template path, exists, structure errors, defaults, limits
    """
    return get_template_info()


@router.post("/ref2va/build", summary="build REF2VA workflow JSON (ยังไม่ยิง ComfyUI)")
def build_workflow(payload: BuildWorkflowRequest) -> dict[str, Any]:
    """
    สร้าง workflow JSON จาก parameters และ validate reference files

    Description:
        - ใช้ทดสอบว่า template + reference + parameters ถูกรวมกันถูกต้อง
        - ยังไม่ยิง ComfyUI
        - คืน workflow JSON ที่พร้อมส่งให้ ComfyUI /prompt ใน STEP 8.4

    Returns:
        dict containing:
            - status
            - workflow
            - used_seed

    Raises:
        HTTPException 400: parameter/reference ผิด
        HTTPException 500: template ผิด
    """
    try:
        workflow = build_ref2va_workflow(
            prompt=payload.prompt,
            reference_filenames=payload.reference_filenames,
            seed=payload.seed,
            duration=payload.duration,
            aspect_ratio=payload.aspect_ratio,
            megapixels=payload.megapixels,
            lora_strength=payload.lora_strength,
            sampler_name=payload.sampler_name,
            sigmas=payload.sigmas,
            filename_prefix=payload.filename_prefix,
        )
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except WorkflowTemplateError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"build workflow ไม่สำเร็จ: {exc}",
        ) from exc

    used_seed = workflow["129"]["inputs"]["noise_seed"]

    return {
        "status": "ok",
        "used_seed": used_seed,
        "workflow": workflow,
    }