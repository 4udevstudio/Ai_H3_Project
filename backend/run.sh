#!/usr/bin/env bash
# ReelFire API. systemd unit name: reelfire-backend
# Activate the backend venv and run uvicorn on 127.0.0.1:8000 with reload.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -x venv/bin/python ]]; then
  echo "[ERROR] venv is missing. From the repo root, run ./install.sh first."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[WARN] ffmpeg is not on PATH. Frame extract and /jobs/export need it."
fi

# shellcheck disable=SC1091
source venv/bin/activate
exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
