"""
========================================
Queue Service
========================================
Description:
    ระบบ queue กลางของ FastAPI backend
    ใช้จัดการงาน generate แบบ FIFO

Current behavior:
    - เรียก H3 service จริงผ่าน ComfyUI
    - งานจะถูกประมวลผลทีละ 1 งาน
    - progress มาจาก ComfyUI WebSocket
    - รองรับ pending / running / done / cancelled / failed
    - เพิ่ม aspect_ratio และ duration สำหรับ STEP 8.5/8.6

Future behavior:
    - เพิ่ม T2V / FL2VA / batch shots
    - เพิ่ม model selector / VRAM guard
    - เพิ่ม thumbnail generation ระดับ advanced
"""
from __future__ import annotations

import threading
import traceback
import uuid
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.h3_service import GenerationCancelled, process_job


def utc_now() -> datetime:
    """
    คืนค่าเวลา UTC ปัจจุบันแบบ timezone-aware
    """
    return datetime.now(timezone.utc)


@dataclass
class QueueJob:
    """
    โครงสร้างข้อมูลของงาน 1 งานใน queue
    """
    id: str
    prompt: str
    type: str
    resolution: str
    steps: int
    seed: int
    duration_seconds: float = 5.0
    aspect_ratio: str = "16:9 (Widescreen)"
    negative_prompt: Optional[str] = None
    task_adapter: Optional[str] = None
    lora_used: Optional[str] = None
    status: str = "PENDING"
    progress: int = 0
    current_step: int = 0
    total_steps: int = 6
    message: str = "รอในคิว"
    reference_count: int = 0
    reference_names: list[str] = field(default_factory=list)
    first_frame_name: Optional[str] = None
    last_frame_name: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    engine: str = "comfyui-ref2va"
    comfyui_prompt_id: Optional[str] = None
    video_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    output_filename: Optional[str] = None
    duration: Optional[float] = None
    stage: Optional[str] = None


class QueueService:
    """
    Service สำหรับจัดการ queue งาน generate
    """

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, QueueJob] = OrderedDict()
        self._lock = threading.RLock()
        self._worker: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start_worker(self) -> None:
        """
        เริ่ม background worker สำหรับประมวลผล queue
        """
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return

            self._stop_event.clear()
            self._worker = threading.Thread(
                target=self._worker_loop,
                name="h3-generation-worker",
                daemon=True,
            )
            self._worker.start()

    def stop_worker(self) -> None:
        """
        หยุด background worker อย่างปลอดภัย
        """
        self._stop_event.set()

        if self._worker is not None:
            self._worker.join(timeout=2)

        with self._lock:
            for job in self._jobs.values():
                if job.status == "RUNNING":
                    job.status = "CANCELLED"
                    job.message = "ถูกหยุดเนื่องจาก backend ปิด/รีสตาร์ท"
                    job.stage = "cancelled"
                    job.updated_at = utc_now()

    def create_job(
        self,
        prompt: str,
        type_: str,
        resolution: str,
        steps: int,
        seed: int,
        duration_seconds: Optional[float] = None,
        negative_prompt: Optional[str] = None,
        task_adapter: Optional[str] = None,
        lora_used: Optional[str] = None,
        reference_names: Optional[list[str]] = None,
        aspect_ratio: Optional[str] = None,
        first_frame_name: Optional[str] = None,
        last_frame_name: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        สร้างงานใหม่เข้า queue
        """
        refs = reference_names or []

        job = QueueJob(
            id=self._generate_id(),
            prompt=prompt.strip(),
            negative_prompt=negative_prompt.strip() if negative_prompt else None,
            type=type_,
            resolution=resolution,
            aspect_ratio=(aspect_ratio or "16:9 (Widescreen)").strip(),
            steps=steps,
            seed=seed,
            duration_seconds=float(duration_seconds or 5.0),
            task_adapter=task_adapter,
            lora_used=lora_used,
            total_steps=6,
            reference_count=len(refs),
            reference_names=refs,
            first_frame_name=first_frame_name,
            last_frame_name=last_frame_name,
            message="รอในคิว",
            stage="pending",
        )

        with self._lock:
            self._jobs[job.id] = job

        return self._snapshot(job)

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        """
        คืนรายการงานทั้งหมด เรียงจากใหม่ไปเก่า
        """
        with self._lock:
            jobs = sorted(
                self._jobs.values(),
                key=lambda job: job.created_at,
                reverse=True,
            )
            return [self._snapshot(job) for job in jobs[:limit]]

    def get_job(self, job_id: str) -> Optional[dict[str, Any]]:
        """
        คืนงานตาม id ถ้ามี
        """
        with self._lock:
            job = self._jobs.get(job_id)

            if job is None:
                return None

            return self._snapshot(job)

    def cancel_job(self, job_id: str) -> Optional[dict[str, Any]]:
        """
        ยกเลิกงานถ้ายังไม่เสร็จ
        """
        with self._lock:
            job = self._jobs.get(job_id)

            if job is None:
                return None

            if job.status in {"DONE", "FAILED", "CANCELLED"}:
                return self._snapshot(job)

            job.status = "CANCELLED"
            job.message = "ยกเลิกแล้ว"
            job.stage = "cancelled"
            job.updated_at = utc_now()

            return self._snapshot(job)

    def delete_job(self, job_id: str) -> bool:
        """
        ลบงานออกจาก queue

        Description:
            ถ้างานกำลัง RUNNING จะถูกตั้งค่าเป็น CANCELLED ก่อนลบ
            เพื่อให้ worker/h3 service ตรวจพบและหยุดงานนั้น
        """
        with self._lock:
            job = self._jobs.get(job_id)

            if job is None:
                return False

            if job.status == "RUNNING":
                job.status = "CANCELLED"
                job.message = "ถูกยกเลิกจากการลบงาน"
                job.stage = "cancelled"
                job.updated_at = utc_now()

            self._jobs.pop(job_id, None)
            return True

    def clear_finished_jobs(self) -> int:
        """
        ลบงานที่เสร็จ/ยกเลิก/ล้มเหลวออกจาก queue
        """
        finished_statuses = {"DONE", "CANCELLED", "FAILED"}

        with self._lock:
            ids_to_remove = [
                job_id
                for job_id, job in self._jobs.items()
                if job.status in finished_statuses
            ]

            for job_id in ids_to_remove:
                self._jobs.pop(job_id, None)

            return len(ids_to_remove)

    def _worker_loop(self) -> None:
        """
        Background loop สำหรับประมวลผลงานใน queue ด้วย ComfyUI จริง
        """
        while not self._stop_event.is_set():
            job_id: Optional[str] = None

            with self._lock:
                for candidate_id, job in self._jobs.items():
                    if job.status == "PENDING":
                        job.status = "RUNNING"
                        job.message = "กำลังส่งงานเข้า ComfyUI"
                        job.stage = "starting"
                        job.updated_at = utc_now()
                        job_id = candidate_id
                        break

            if job_id is None:
                self._stop_event.wait(0.5)
                continue

            try:
                with self._lock:
                    job = self._jobs.get(job_id)

                if job is None or job.status != "RUNNING":
                    continue

                process_job(job)

            except GenerationCancelled:
                with self._lock:
                    job = self._jobs.get(job_id)

                    if job is not None and job.status == "RUNNING":
                        job.status = "CANCELLED"
                        job.message = "ถูกยกเลิก"
                        job.stage = "cancelled"
                        job.updated_at = utc_now()

            except Exception as exc:
                traceback.print_exc()

                with self._lock:
                    job = self._jobs.get(job_id)

                    if job is not None:
                        job.status = "FAILED"
                        job.error = f"{type(exc).__name__}: {exc}"
                        job.message = "ประมวลผลล้มเหลว ดู error ใน API /api/generations"
                        job.stage = "failed"
                        job.updated_at = utc_now()

            finally:
                with self._lock:
                    job = self._jobs.get(job_id)

                    if job is not None and job.status == "RUNNING":
                        if self._stop_event.is_set():
                            job.status = "CANCELLED"
                            job.message = "ถูกหยุดเนื่องจาก backend ปิด/รีสตาร์ท"
                            job.stage = "cancelled"
                        else:
                            job.status = "FAILED"
                            job.error = "Engine ended without final status"
                            job.message = "ประมวลผลล้มเหลว"
                            job.stage = "failed"

                        job.updated_at = utc_now()

    @staticmethod
    def _generate_id() -> str:
        """
        สร้าง id สำหรับ job
        """
        return str(uuid.uuid4())

    @staticmethod
    def _snapshot(job: QueueJob) -> dict[str, Any]:
        """
        แปลง QueueJob เป็น dict สำหรับส่งกลับ API
        """
        return asdict(job)


# singleton instance สำหรับใช้ร่วมกันทั้ง backend
queue_service = QueueService()