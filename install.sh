#!/usr/bin/env bash
# ReelFire installer for Linux and macOS. 4udevstudio By Firework.
# Mirrors install.bat: Node, Python, ffmpeg, env files, npm, Prisma, venv.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "========================================"
echo "  ReelFire - Install"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found. Install Node.js 20 LTS or newer."
  exit 1
fi

pick_python() {
  if command -v python3.11 >/dev/null 2>&1; then
    echo python3.11
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo python3
    return
  fi
  echo "[ERROR] Python 3.11 (or python3) was not found." >&2
  exit 1
}

PY="$(pick_python)"
echo "[INFO] Python: $("$PY" --version)"
echo "[INFO] Node: $(node -v)"

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "[ERROR] ffmpeg and ffprobe must be on PATH."
  echo "        Debian/Ubuntu: sudo apt install ffmpeg"
  echo "        macOS: brew install ffmpeg"
  exit 1
fi
echo "[INFO] ffmpeg: $(ffmpeg -version | head -n 1)"

copy_if_missing() {
  local dest="$1"
  local src="$2"
  if [[ -f "$dest" ]]; then
    return
  fi
  if [[ ! -f "$src" ]]; then
    echo "[ERROR] Missing example file: $src"
    exit 1
  fi
  cp "$src" "$dest"
  echo "[INFO] Created $dest from $(basename "$src")"
}

copy_if_missing ".env" ".env.example"
copy_if_missing "backend/.env" "backend/.env.example"
copy_if_missing "backend/config.json" "backend/config.example.json"
echo "[!] Edit backend/config.json so comfyui_root and comfyui_input_dir match this machine."
echo "[!] Leave ffmpeg_path empty when ffmpeg is already on PATH."

echo "[1/4] npm install..."
npm install

echo "[2/4] prisma generate + db push..."
npx prisma generate
npx prisma db push

echo "[3/4] npm run build..."
npm run build

echo "[4/4] python venv + pip install..."
if [[ ! -d backend/venv ]]; then
  "$PY" -m venv backend/venv
fi
# shellcheck disable=SC1091
source backend/venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt

echo
echo "========================================"
echo "  Install finished."
echo "  Next: edit backend/config.json, start ComfyUI on port 8188, then ./start.sh"
echo "========================================"
