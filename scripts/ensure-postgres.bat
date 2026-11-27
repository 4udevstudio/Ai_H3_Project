@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."

REM Skip Docker when .env points at a Postgres other than the bundled compose database.
set "DEFAULT_URL=postgresql://reelfire:reelfirepassword@localhost:5432/reelfire?schema=public"
set "DBURL="
if exist ".env" (
  for /f "usebackq tokens=1* delims==" %%A in (".env") do (
    if /I "%%A"=="DATABASE_URL" set "DBURL=%%B"
  )
)
set "DBURL=!DBURL:"=!"
if not "!DBURL!"=="" if /I not "!DBURL!"=="!DEFAULT_URL!" (
  echo [DB] DATABASE_URL points at an existing Postgres. Skipping Docker.
  exit /b 0
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker was not found, so Postgres cannot be started.
  echo [ERROR] Install Docker Desktop and leave it running,
  echo [ERROR] or set DATABASE_URL in .env to an existing Postgres and run this again.
  exit /b 1
)
docker compose version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] docker compose is not available. Install Docker Desktop.
  exit /b 1
)

echo [DB] docker compose up -d postgres
docker compose up -d postgres
if errorlevel 1 exit /b 1

set /a TRIES=0
:waitpg
set /a TRIES+=1
docker compose exec -T postgres pg_isready -U reelfire -d reelfire >nul 2>nul
if not errorlevel 1 (
  echo [DB] Postgres is healthy
  exit /b 0
)
if !TRIES! GEQ 30 (
  echo [ERROR] Postgres did not become healthy in time.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitpg
