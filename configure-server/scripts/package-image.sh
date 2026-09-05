#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-configure-server:latest}"
OUT="${OUT:-../deploy/dist/configure-server-image.tar}"
mkdir -p "$(dirname "$OUT")"

echo "==> docker build ${IMAGE}"
docker build -t "$IMAGE" -f Dockerfile ..

echo "==> docker save → ${OUT}"
docker save "$IMAGE" -o "$OUT"
ls -lh "$OUT"
echo "上传后在服务器: docker load -i configure-server-image.tar"
