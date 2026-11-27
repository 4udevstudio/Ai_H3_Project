#!/usr/bin/env bash
# Start FastAPI on 0.0.0.0:8000 and the Next.js production server on 0.0.0.0:3000.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -x backend/venv/bin/python ]]; then
  echo "[ERROR] Backend venv is missing. Run ./install.sh first."
  exit 1
fi
if [[ ! -x node_modules/.bin/next ]]; then
  echo "[ERROR] Frontend dependencies are missing. Run ./install.sh first."
  exit 1
fi
if [[ ! -f backend/config.json ]]; then
  echo "[ERROR] backend/config.json is missing. Run ./install.sh first."
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "[WARN] ffmpeg/ffprobe not on PATH. Frame extract and film export will fail until they are installed."
fi

lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  fi
  if [[ -z "$ip" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  printf '%s\n' "$ip"
}

LAN_IP="$(lan_ip)"
BACKEND_PID=""

cleanup() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "========================================"
echo "  ReelFire"
echo "  Web:      http://localhost:3000"
echo "  LAN:      http://${LAN_IP}:3000"
echo "  Backend:  http://${LAN_IP}:8000"
echo "  Swagger:  http://${LAN_IP}:8000/docs"
echo "  ComfyUI must be listening on port 8188"
echo "========================================"

# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-postgres.sh"
ensure_postgres
npx prisma migrate deploy

echo "[START] FastAPI"
(
  cd "$ROOT/backend"
  export PYTHONUNBUFFERED=1
  # shellcheck disable=SC1091
  source venv/bin/activate
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info
) &
BACKEND_PID=$!

echo "[BUILD] npm run build (use ./start-fast.sh to skip this)"
npm run build

echo "[START] Next.js"
npm start -- -H 0.0.0.0 -p 3000
