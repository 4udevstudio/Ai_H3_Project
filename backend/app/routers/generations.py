"""
========================================
Generations Router
========================================
Description:
    API สำหรับจัดการ queue งาน generate

Endpoints:
    GET    /api/generations/              : ดึงรายการงานในคิว
    POST   /api/generations/              : สร้างงานใหม่เข้าคิว
    GET    /api/generations/{job_id}      : ดึงงานตาม id
    POST   /api/generations/{job_id}/cancel : ยกเลิกงาน
    DELETE /api/generations/{job_id}      : ลบงานออกจากคิว
    POST   /api/generations/clear-finished : ลบงานที่เสร็จแล้วทั้งหมด
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import workflow_service
from app.services.queue_service import queue_service

router = APIRouter()


class CreateGenerationRequest(BaseModel):
    """
    Request body สำหรับสร้างงาน generate ใหม่
    """
    prompt: str = Field(..., min_length=1, description="prompt หลัก")
    negative_prompt: Optional[str] = Field(None, description="negative prompt")
    type: str = Field("REF2VID", description="ประเภทงาน เช่น REF2VID")
    resolution: str = Field("480p", description="resolution เช่น 480p, 768p, 1080p")
    aspect_ratio: Optional[str] = Field(
        None,
        description="aspect ratio เช่น 16:9 (Widescreen), 9:16 (Portrait), 1:1 (Square)",
    )
    steps: int = Field(6, ge=1, le=50, description="จำนวน steps")
    seed: int = Field(-1, description="seed, -1 = สุ่ม")
    duration_seconds: float = Field(
        5.0,
        ge=1,
        le=30,
        description="ความยาววิดีโอเป้าหมายเป็นวินาที (แนะนำไม่เกิน 15)",
    )
    task_adapter: Optional[str] = Field(None, description="task adapter")
    lora_used: Optional[str] = Field(None, description="LoRA ที่ใช้")
    reference_names: Optional[list[str]] = Field(
        default=None,
        max_length=10,
        description="stored_filename จาก upload API สูงสุด 10 ไฟล์",
    )
    first_frame_name: Optional[str] = Field(
        None,
        description="ชื่อไฟล์เฟรมแรกใน ComfyUI input (FL2VA)",
    )
    last_frame_name: Optional[str] = Field(
        None,
        description="ชื่อไฟล์เฟรมสุดท้ายใน ComfyUI input (FL2VA)",
    )


@router.get("/", summary="ดึงรายการงานในคิว")
def list_generations(
    limit: int = Query(100, ge=1, le=500, description="จำนวนงานสูงสุด"),
) -> list[dict[str, Any]]:
    """
    คืนรายการงานทั้งหมดใน queue เรียงจากใหม่ไปเก่า
    """
    return queue_service.list_jobs(limit=limit)


@router.post("/", summary="สร้างงานใหม่เข้าคิว")
def create_generation(
    payload: CreateGenerationRequest,
) -> dict[str, Any]:
    """
    สร้างงาน generate ใหม่เข้า queue
    """
    try:
        wtype = workflow_service.normalize_workflow_type(payload.type)
    except workflow_service.WorkflowValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if wtype == workflow_service.WORKFLOW_FL2VA:
        has_frames = bool(
            payload.first_frame_name
            or payload.last_frame_name
            or payload.reference_names
        )
        if not has_frames:
            raise HTTPException(
                status_code=400,
                detail="FL2VA ต้องมี first frame หรือ last frame อย่างน้อย 1 รูป",
            )

    return queue_service.create_job(
        prompt=payload.prompt,
        type_=wtype,
        resolution=payload.resolution,
        aspect_ratio=payload.aspect_ratio,
        steps=payload.steps,
        seed=payload.seed,
        duration_seconds=payload.duration_seconds,
        negative_prompt=payload.negative_prompt,
        task_adapter=payload.task_adapter,
        lora_used=payload.lora_used,
        reference_names=payload.reference_names,
        first_frame_name=payload.first_frame_name,
        last_frame_name=payload.last_frame_name,
    )


@router.get("/clear-finished", include_in_schema=False)
def clear_finished_get_not_allowed() -> None:
    """
    ป้องกันการเรียก clear-finished ด้วย GET
    """
    raise HTTPException(status_code=405, detail="clear-finished ใช้ได้เฉพาะ POST")


@router.post("/clear-finished", summary="ลบงานที่เสร็จแล้วออกจากคิว")
def clear_finished_generations() -> dict[str, int]:
    """
    ลบงานที่ DONE / CANCELLED / FAILED ออกจาก queue ทั้งหมด
    """
    deleted = queue_service.clear_finished_jobs()
    return {"deleted": deleted}


@router.get("/{job_id}", summary="ดึงงานตาม id")
def get_generation(job_id: str) -> dict[str, Any]:
    """
    คืนข้อมูลงานตาม id
    """
    job = queue_service.get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="ไม่พบงานใน queue")

    return job


@router.post("/{job_id}/cancel", summary="ยกเลิกงาน")
def cancel_generation(job_id: str) -> dict[str, Any]:
    """
    ยกเลิกงานตาม id ถ้ายังไม่เสร็จ
    """
    job = queue_service.cancel_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="ไม่พบงานใน queue")

    return job


@router.delete("/{job_id}", summary="ลบงานออกจากคิว")
def delete_generation(job_id: str) -> dict[str, bool]:
    """
    ลบงานออกจาก queue ตาม id
    """
    deleted = queue_service.delete_job(job_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="ไม่พบงานใน queue")

    return {"deleted": True}