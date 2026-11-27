@echo off
rem ========================================
rem ReelFire API (reelfire-backend). 4udevstudio By Firework.
rem Description: activate venv แล้วรัน uvicorn ที่ port 8000
rem ========================================
cd /d %~dp0
call venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause