@echo off
rem ========================================
rem สคริปต์เปิดตัว backend MiniMax H3 Studio
rem Description: activate venv แล้วรัน uvicorn ที่ port 8000
rem ========================================
cd /d %~dp0
call venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause