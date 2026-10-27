#!/bin/bash
set -euo pipefail
pkill -f '/app/main|/bin/linux_amd64/main|configure-server' || true
