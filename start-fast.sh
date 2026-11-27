#!/usr/bin/env bash
# Start the stack without rebuilding Next.js.
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
if [[ ! -d .next ]]; then
  echo "[ERROR] No production build yet. Run ./start.sh once before ./start-fast.sh."
  exit 1
fi

lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
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
echo "  ReelFire - fast start"
echo "  Web: http://localhost:3000"
echo "  LAN: http://${LAN_IP}:3000"
echo "========================================"

(
  cd "$ROOT/backend"
  export PYTHONUNBUFFERED=1
  # shellcheck disable=SC1091
  source venv/bin/activate
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info
) &
BACKEND_PID=$!

sleep 1
npm start -- -H 0.0.0.0 -p 3000
