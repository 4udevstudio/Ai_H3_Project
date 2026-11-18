@echo off
setlocal EnableDelayedExpansion
title MiniMax H3 Studio - Fast Start (No Build)
cd /d "%~dp0"

REM ---- Pre-flight check ----
if not exist "backend\venv\Scripts\python.exe" (
  echo [ERROR] ยังไม่ได้ติดตั้ง backend venv
  echo [ERROR] กรุณารัน install.bat ก่อน
  pause
  exit /b 1
)
if not exist "node_modules\.bin\next.cmd" (
  echo [ERROR] ยังไม่ได้ติดตั้ง frontend dependencies
  echo [ERROR] กรุณารัน install.bat ก่อน
  pause
  exit /b 1
)
if not exist ".next" (
  echo [ERROR] ยังไม่เคย build
  echo [ERROR] กรุณารัน start.bat (full build) ครั้งแรกก่อน
  pause
  exit /b 1
)

REM ---- Detect LAN IP ----
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 | ForEach-Object { (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4).IPAddress }) } catch { '' }"`) do set "LAN_IP=%%i"
if "!LAN_IP!"=="" set "LAN_IP=127.0.0.1"

echo ========================================
echo   MiniMax H3 Studio - FAST MODE
echo   (ข้าม build - ใช้โค้ดล่าสุดที่ build ไว้)
echo ----------------------------------------
echo   เครื่องนี้:      http://localhost:3000
echo   เพื่อนใน LAN:   http://!LAN_IP!:3000
echo ========================================
echo.

REM ---- Start Backend ----
start "H3 Backend" cmd /k "title H3 Backend && cd /d "%~dp0backend" && set PYTHONUNBUFFERED=1 && call venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info"

REM ---- Start Frontend (ข้าม build) ----
timeout /t 2 /nobreak >nul
start "H3 Frontend" cmd /k "title H3 Frontend && cd /d "%~dp0" && npm start -- -H 0.0.0.0 -p 3000"

echo เปิด 2 หน้าต่างแล้ว (Backend / Frontend)
echo หยุดระบบ = ปิดทั้ง 2 หน้าต่าง
pause