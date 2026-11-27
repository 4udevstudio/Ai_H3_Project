"""
========================================
LLM Service (stub)
========================================
Description:
    คลาสจัดการโมเดล Gemma (GGUF ผ่าน llama-cpp-python)
    ฉบับนี้เป็น stub เก็บสถานะเท่านั้น — GET /api/llm/status ยังคืน loaded/model

    Script-to-scenes ไม่ได้ใช้ไฟล์นี้. งานนั้นเรียก ComfyUI Gemma ในเครื่อง
    (TextGenerateV2 → PreviewAny) ผ่าน app.services.script_scene_service
    เพื่อไม่ต้องใช้ cloud API key และไม่ต้องโหลด GGUF แยก.
"""


class LLMService:
    """จัดการการโหลด/ปล่อยโมเดล LLM และการสร้าง prompt"""

    def __init__(self) -> None:
        # สถานะว่าโมเดลถูกโหลดเข้า VRAM อยู่หรือไม่
        self.loaded = False
        # ชื่อโมเดลที่โหลดอยู่
        self.model_name: str | None = None

    def status(self) -> dict:
        """คืนสถานะปัจจุบันของ LLM (ใช้กับ API /api/llm/status)"""
        return {"loaded": self.loaded, "model": self.model_name}


# instance หลักที่ใช้ร่วมกันทั้ง backend (singleton)
llm_service = LLMService()