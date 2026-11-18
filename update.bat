@echo off
setlocal EnableDelayedExpansion
title Ai-H3-Studio-Generator - Update - By Ton Like IT
cd /d "%~dp0"

chcp 65001 >nul 2>nul

echo ========================================
echo   Ai-H3-Studio-Generator - Updater - By Ton Like IT
echo ========================================
echo.

REM ---- 1) เช็กว่าเป็น git repo จริง ----
if not exist ".git" (
  echo [ERROR] ไม่พบ .git - ใช้งานจากโฟลเดอร์ที่ clone มาจาก GitHub เท่านั้น
  pause
  exit /b 1
)

REM ---- 2) เช็กว่ามีงานที่ยังไม่ commit ไหม ----
git status --porcelain > .git_status_tmp 2>nul
set /p STATUS_LINE=<.git_status_tmp 2>nul
del .git_status_tmp >nul 2>nul

if defined STATUS_LINE (
  echo [WARNING] พบไฟล์ที่ยังไม่ได้ commit:
  git status --short
  echo.
  echo การ pull จะใช้ --autostash เก็บการเปลี่ยนแปลงชั่วคราว
  choice /C YN /M "ต้องการดำเนินการต่อหรือไม่"
  if errorlevel 2 (
    echo ยกเลิกการอัปเดต
    pause
    exit /b 0
  )
)

REM ---- 3) แสดง branch + remote ปัจจุบัน ----
for /f "tokens=*" %%b in ('git branch --show-current 2^>nul') do set "BRANCH=%%b"
for /f "tokens=*" %%r in ('git remote get-url origin 2^>nul') do set "REMOTE_URL=%%r"

echo [INFO] Branch: !BRANCH!
echo [INFO] Remote: !REMOTE_URL!
echo.

REM ---- 4) ดึงโค้ดใหม่ ----
echo [1/5] ดึงโค้ดใหม่จาก GitHub...
git pull --autostash --rebase origin !BRANCH!
if errorlevel 1 (
  echo [ERROR] git pull ล้มเหลว
  echo [!] อาจมี conflict - เปิด VS Code แล้ว resolve conflict ก่อน
  echo [!] หรือลอง: git status, git add, git rebase --continue
  pause
  exit /b 1
)
echo [OK] ดึงโค้ดเรียบร้อย
echo.

REM ---- 5) แสดง commit ใหม่ที่ดึงมา ----
echo [2/5] Commit ล่าสุด:
git log --oneline -5
echo.

REM ---- 6) ติดตั้ง/อัปเดต dependencies ----
echo [3/5] ติดตั้ง dependencies ใหม่ (ถ้ามี)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install ล้มเหลว
  pause
  exit /b 1
)

if exist "backend\venv\Scripts\activate.bat" (
  cd backend
  call venv\Scripts\activate.bat
  echo [INFO] อัปเดต pip + dependencies ใน venv...
  python -m pip install --upgrade pip --quiet
  pip install -r requirements.txt --quiet
  if errorlevel 1 (
    echo [ERROR] pip install ล้มเหลว
    cd ..
    pause
    exit /b 1
  )
  cd ..
) else (
  echo [WARNING] ไม่พบ backend\venv - ข้ามขั้นตอน backend dependencies
  echo [!] ถ้า backend error ให้รัน install.bat อีกครั้ง
)
echo [OK] dependencies พร้อม
echo.

REM ---- 7) อัปเดต database schema (ถ้ามี) ----
echo [4/5] อัปเดต database schema...
if exist ".env" (
  call npx prisma generate --quiet
  call npx prisma db push --quiet
  if errorlevel 1 (
    echo [WARNING] prisma มี error - อาจไม่เป็นไรถ้า schema ไม่เปลี่ยน
  ) else (
    echo [OK] schema updated
  )
) else (
  echo [WARNING] ไม่พบ .env - ข้ามขั้นตอน prisma
  echo [!] รัน install.bat อีกครั้งถ้ามีปัญหา
)
echo.

REM ---- 8) Build ใหม่ ----
echo [5/5] build หน้าเว็บใหม่...
call npm run build
if errorlevel 1 (
  echo [ERROR] build ล้มเหลว
  echo [!] อาจเป็นเพราะ dependencies เปลี่ยนมาก
  echo [!] ลองรัน install.bat ใหม่: rmdir /s /q node_modules venv แล้วรัน install.bat
  pause
  exit /b 1
)
echo [OK] build สำเร็จ
echo.

echo ========================================
echo   อัปเดตเสร็จสมบูรณ์!
echo ----------------------------------------
echo   รัน start.bat เพื่อเปิดระบบ
echo ----------------------------------------
echo   ถ้ามีปัญหาลอง:
echo   1) ปิดหน้าต่าง backend/frontend ก่อน
echo   2) รัน start.bat ใหม่
echo   3) ถ้ายังไม่หาย ให้รัน install.bat ใหม่
echo ========================================
pause