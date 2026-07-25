#!/usr/bin/env bash
set -euo pipefail

PORT="${AW_APP_PORT:-10011}"

cd /app
exec npx vite --host 0.0.0.0 --port "${PORT}" --strictPort
