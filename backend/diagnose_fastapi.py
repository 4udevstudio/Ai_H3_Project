"""
diagnose_fastapi.py
ไว้ตรวจว่า FastAPI ใน venv ปกติหรือไม่
ถ้าสคริปต์นี้ยัง include_router ไม่ได้ แปลว่า environment/FastAPI เสียชัดๆ
"""

import os
import sys

import fastapi
import starlette
from fastapi import APIRouter, FastAPI

print("=" * 60)
print("Python:", sys.version)
print("CWD:", os.getcwd())
print("sys.path[0]:", sys.path[0] if sys.path else "N/A")
print("fastapi file:", fastapi.__file__)
print("fastapi version:", getattr(fastapi, "__version__", "unknown"))
print("starlette file:", starlette.__file__)
print("=" * 60)

app = FastAPI()
router = APIRouter()


@router.get("/ping")
def ping():
    return {"ok": True}


router_paths = [getattr(r, "path", None) for r in router.routes]
app_before = [getattr(r, "path", None) for r in app.routes]

print("router routes:", router_paths)
print("app routes before include:", app_before)

app.include_router(router, prefix="/api/test")

app_after = [getattr(r, "path", None) for r in app.routes]
print("app routes after include:", app_after)

if "/api/test/ping" not in app_after:
    raise RuntimeError(
        "FastAPI include_router ไม่ทำงาน: ไม่มี /api/test/ping หลัง include_router. "
        "สรุปว่า FastAPI/Starlette ใน environment นี้เสียหรือถูก shadow."
    )

print("OK: FastAPI include_router ทำงานปกติ")