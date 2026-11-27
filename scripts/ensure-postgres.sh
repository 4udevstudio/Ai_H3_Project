#!/usr/bin/env bash
# Start the compose Postgres when DATABASE_URL is unset or the local placeholder.
# Another postgres:// URL means an external database: skip Docker.
# Sourced by install.sh, start.sh, start-fast.sh, and update.sh.
# Bundled compose database. 127.0.0.1 is the current default; localhost is the previous one.
bundled_database_url() {
  local url="$1"
  [[ -z "$url" ]] && return 0
  [[ "$url" == "postgresql://reelfire:reelfirepassword@127.0.0.1:5432/reelfire?schema=public" ]] && return 0
  [[ "$url" == "postgresql://reelfire:reelfirepassword@localhost:5432/reelfire?schema=public" ]] && return 0
  return 1
}

ensure_postgres() {
  local url="${DATABASE_URL:-}"

  if [[ -z "$url" && -f .env ]]; then
    url="$(grep -E '^DATABASE_URL=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi

  if [[ -n "$url" && "$url" == postgres* ]] && ! bundled_database_url "$url"; then
    echo "[INFO] DATABASE_URL points at an existing Postgres. Skipping Docker."
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "[ERROR] Docker is required to start reelfire-postgres."
    echo "        Install Docker, or set DATABASE_URL to an existing Postgres."
    exit 1
  fi

  echo "[INFO] Starting reelfire-postgres (docker compose up -d postgres)"
  docker compose up -d postgres

  local attempt
  for attempt in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U reelfire -d reelfire >/dev/null 2>&1; then
      echo "[INFO] Postgres is healthy"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] reelfire-postgres did not become healthy in time."
  exit 1
}
