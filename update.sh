#!/usr/bin/env bash
# Pull the current branch and refresh npm, pip, Prisma, and the Next.js build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "========================================"
echo "  ReelFire - Update"
echo "========================================"

if [[ ! -d .git ]]; then
  echo "[ERROR] This folder is not a git checkout."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[WARN] There are uncommitted changes:"
  git status --short
  if [[ -t 0 ]]; then
    read -r -p "Continue with git pull --autostash --rebase? [y/N] " answer
    if [[ "${answer}" != "y" && "${answer}" != "Y" ]]; then
      echo "Update cancelled."
      exit 0
    fi
  else
    echo "[ERROR] Refusing to pull a dirty tree without a terminal. Commit or stash first."
    exit 1
  fi
fi

BRANCH="$(git branch --show-current)"
echo "[INFO] Branch: ${BRANCH}"

echo "[1/5] git pull"
git pull --autostash --rebase origin "$BRANCH"
echo "[2/5] Recent commits:"
git log --oneline -5

echo "[3/5] npm install"
npm install --no-audit --no-fund

if [[ -x backend/venv/bin/python ]]; then
  # shellcheck disable=SC1091
  source backend/venv/bin/activate
  python -m pip install --upgrade pip
  pip install -r backend/requirements.txt
else
  echo "[WARN] backend/venv is missing. Run ./install.sh if the API fails to start."
fi

echo "[4/5] prisma generate + db push"
if [[ -f .env ]]; then
  npx prisma generate
  npx prisma db push
else
  echo "[WARN] .env is missing. Run ./install.sh if Prisma fails."
fi

echo "[5/5] npm run build"
npm run build

echo "Update finished. Start with ./start.sh"
