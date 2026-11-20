@echo off
setlocal EnableDelayedExpansion
title MiniMax H3 Studio - Start
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
if not exist "backend\config.json" (
  echo [ERROR] ยังไม่มี backend\config.json
  echo [ERROR] กรุณารัน install.bat ก่อน
  pause
  exit /b 1
)

REM ---- Detect LAN IP ----
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 | ForEach-Object { (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4).IPAddress }) } catch { '' }"`) do set "LAN_IP=%%i"
if "!LAN_IP!"=="" set "LAN_IP=127.0.0.1"

echo ========================================
echo   MiniMax H3 Studio
echo ----------------------------------------
echo   เครื่องนี้:      http://localhost:3000
echo   เพื่อนใน LAN:   http://!LAN_IP!:3000
echo ----------------------------------------
echo   Backend:  http://!LAN_IP!:8000
echo   Swagger:  http://!LAN_IP!:8000/docs
echo ----------------------------------------
echo   [!] ComfyUI ต้องเปิดอยู่ พอร์ต 8188
echo   [!] ครั้งแรก Firewall อาจถาม - กด Allow
echo       (เลือก Private network)
echo ========================================
echo.

REM ---- Start Backend ----
REM PYTHONUNBUFFERED=1 ทำให้ print() แสดง log ทันที (ไม่ buffer)
start "H3 Backend" cmd /k "title H3 Backend && cd /d "%~dp0backend" && set PYTHONUNBUFFERED=1 && call venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info"

REM ---- Build Frontend (ทุกครั้ง) ----
echo [BUILD] กำลัง build frontend ใหม่...
echo [BUILD] (ถ้าอยากข้าม build ใช้ start-fast.bat แทน)
echo.

set "BUILD_START=%TIME%"
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] npm run build ล้มเหลว
  echo [ERROR] กรุณาตรวจสอบ error ด้านบน แล้วลองรัน install.bat ใหม่
  pause
  exit /b 1
)
echo.
echo [BUILD] Build เสร็จสมบูรณ์ (เริ่ม %BUILD_START% สิ้นสุด %TIME%)
echo.

REM ---- Start Frontend ----
echo [START] เปิด frontend (production mode)...
timeout /t 2 /nobreak >nul

start "H3 Frontend" cmd /k "title H3 Frontend && cd /d "%~dp0" && npm start -- -H 0.0.0.0 -p 3000"

REM ---- Wait for server ready then open browser ----
echo [BROWSER] รอ 5 วินาทีให้ backend/frontend พร้อม แล้วเปิดเบราว์เซอร์...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo ========================================
echo   ระบบพร้อมใช้งาน:
echo     [H3 Backend]  - log server + queue
echo     [H3 Frontend] - หน้าเว็บ
echo ----------------------------------------
echo   หยุดระบบ = ปิดทั้ง 2 หน้าต่าง
echo ========================================
pause