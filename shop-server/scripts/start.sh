#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${1:-./bin/linux_amd64/main}"
if [ ! -f "$BIN" ]; then
  echo "error: binary not found: $BIN (run: make build)"
  exit 1
fi

chmod +x "$BIN"
echo "starting shop-server..."
exec "$BIN"
