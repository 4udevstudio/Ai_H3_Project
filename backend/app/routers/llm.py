"""
========================================
LLM Router (ฉบับร่าง)
========================================
Description:
    กลุ่ม API สำหรับ Gemma LLM (ตัวช่วยเขียน prompt)
    ฉบับเต็มจะสั่ง load/unload ผ่าน llm_service
"""
from fastapi import APIRouter

from app.services.llm_service import llm_service

router = APIRouter()


@router.get("/status", summary="สถานะการโหลด LLM")
def llm_status():
    """คืนว่าโมเดล Gemma ถูกโหลดเข้า VRAM อยู่หรือไม่"""
    return llm_service.status()