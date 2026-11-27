@echo off
setlocal EnableDelayedExpansion
title Ai-H3-Studio-Generator - Install - By Ton Like IT
cd /d "%~dp0"

REM ---- เปิด UTF-8 เพื่อแสดงภาษาไทยใน CMD Windows ----
chcp 65001 >nul 2>nul

echo ========================================
echo   Ai-H3-Studio-Generator - Installer - By Ton Like IT
echo ========================================
echo.

REM ---- 1) Check prerequisites ----
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ไม่พบ Node.js - ติดตั้งจาก https://nodejs.org ก่อน
  pause
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ไม่พบ Python - ติดตั้ง Python 3.11 ก่อน
  pause
  exit /b 1
)

REM ---- 2) Detect LAN IP (ไว้แสดงเฉยๆ ตอนรัน) ----
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 | ForEach-Object { (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4).IPAddress }) } catch { '' }"`) do set "LAN_IP=%%i"
if "!LAN_IP!"=="" set "LAN_IP=127.0.0.1"
echo [INFO] LAN IP เครื่องนี้: !LAN_IP!
echo.

REM ---- 3) สร้าง .env จาก example (จำเป็นสำหรับ Prisma v6+) ----
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [INFO] สร้าง .env จาก .env.example แล้ว
  ) else (
    echo [ERROR] ไม่พบ .env.example
    pause
    exit /b 1
  )
)

REM ---- 3.1) สร้าง backend\.env จาก example ----
if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [INFO] สร้าง backend\.env จาก backend\.env.example แล้ว
  ) else (
    echo [ERROR] ไม่พบ backend\.env.example
    pause
    exit /b 1
  )
)

REM ---- 4) Backend config ----
REM ระบบใช้ runtime backend URL (อ่านจาก URL หน้าเว็บอัตโนมัติ)
REM ดังนั้นไม่ต้องสร้าง .env.local หรือตั้ง NEXT_PUBLIC_BACKEND_URL
REM ถ้าอยาก lock URL ชัดเจน (เช่น เปิดจาก tablet) ค่อยสร้าง .env.local เอง:
REM   echo NEXT_PUBLIC_BACKEND_URL=http://!LAN_IP!:8000 > ".env.local"
REM   แล้วรัน npm run build ใหม่

if not exist "backend\config.json" (
  if exist "backend\config.example.json" (
    copy "backend\config.example.json" "backend\config.json" >nul
    echo [INFO] สร้าง backend\config.json จาก example แล้ว
    echo [!] แก้ comfyui_root / comfyui_input_dir ใน backend\config.json ให้ตรงกับเครื่องคุณ
    echo [!] ถ้าใช้ RunPod Pod ตั้งค่าผ่านหน้า Settings ได้ภายหลัง
  ) else (
    echo [ERROR] ไม่พบ backend\config.example.json
    pause
    exit /b 1
  )
)

REM ---- 5) Postgres, then frontend deps + DB + build ----
echo [DB] Starting or checking Postgres...
call "%~dp0scripts\ensure-postgres.bat"
if errorlevel 1 (
  echo [ERROR] Postgres is not ready
  pause
  exit /b 1
)

echo [1/5] npm install...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install ล้มเหลว
  pause
  exit /b 1
)

echo [2/5] prisma generate + migrate deploy + seed...
call npx prisma generate
if errorlevel 1 (
  echo [ERROR] prisma generate ล้มเหลว
  pause
  exit /b 1
)
call npx prisma migrate deploy
if errorlevel 1 (
  echo [ERROR] prisma migrate deploy ล้มเหลว
  pause
  exit /b 1
)
call npx prisma db seed
if errorlevel 1 (
  echo [ERROR] prisma db seed ล้มเหลว
  pause
  exit /b 1
)

echo [3/5] npm run build...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build ล้มเหลว
  pause
  exit /b 1
)

REM ---- 6) Backend: venv + pip ----
echo [4/5] python venv + pip install...
cd backend
if not exist "venv" (
  echo [INFO] สร้าง python venv...
  python -m venv venv
  if errorlevel 1 (
    echo [ERROR] สร้าง venv ไม่สำเร็จ
    cd ..
    pause
    exit /b 1
  )
)
call venv\Scripts\activate.bat
echo [INFO] อัปเกรด pip...
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install ล้มเหลว
  cd ..
  pause
  exit /b 1
)
cd ..

echo.
echo ========================================
echo   ติดตั้งเสร็จสมบูรณ์!
echo ----------------------------------------
echo   ขั้นตอนถัดไป:
echo   1) แก้ backend\config.json
echo      - comfyui_root = path โฟลเดอร์ ComfyUI
echo      - comfyui_input_dir = path input folder
echo   2) เปิด ComfyUI ไว้ที่พอร์ต 8188
echo   3) รัน start.bat
echo ----------------------------------------
echo   ใช้ LAN (เพื่อนในวงเดียวกัน):
echo   เปิด http://!LAN_IP!:3000
echo ========================================
pause