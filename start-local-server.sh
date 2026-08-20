#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${1:-${PORT:-8000}}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: Python 3 is required to start the local server." >&2
  exit 1
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  echo "Error: the port must be an integer between 1 and 65535." >&2
  exit 1
fi

echo "Launching Schematics Builder: http://${HOST}:${PORT}"


exec python3 -m http.server "$PORT" --bind "$HOST" --directory "$PROJECT_DIR"
