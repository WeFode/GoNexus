#!/usr/bin/env bash
# 本机 Go 交叉编译 + scratch 镜像，不拉取 docker.io 基础镜像。
#   ./package.sh
#   ./package.sh linux/arm64
#   ./package.sh linux/amd64 shop-server
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="${1:-linux/amd64}"
SERVICE="${2:-}"
OUT_DIR="${OUT_DIR:-$ROOT/deploy/dist}"
CATALOG="$ROOT/deploy/catalog.json"
RUNTIME="$ROOT/deploy/runtime.Dockerfile"

if ! command -v docker >/dev/null; then echo "未检测到 Docker" >&2; exit 1; fi
if ! command -v go >/dev/null; then echo "未检测到 Go" >&2; exit 1; fi
if ! command -v python3 >/dev/null; then echo "需要 python3" >&2; exit 1; fi

mkdir -p "$OUT_DIR"
TAG_PLAT="${PLATFORM//\//-}"
GOARCH=amd64
[[ "$PLATFORM" == *arm64* || "$PLATFORM" == *aarch64* ]] && GOARCH=arm64

mapfile -t NAMES < <(python3 - "$CATALOG" "$SERVICE" <<'PY'
import json, sys
catalog = json.load(open(sys.argv[1], encoding="utf-8"))
want = sys.argv[2]
for s in catalog["services"]:
    if want and s["name"] != want:
        continue
    print(s["name"])
PY
)
if [[ ${#NAMES[@]} -eq 0 ]]; then echo "未知服务: $SERVICE" >&2; exit 1; fi

for name in "${NAMES[@]}"; do
  port="$(python3 -c "import json; c=json.load(open(r'$CATALOG',encoding='utf-8')); print(next(s['containerPort'] for s in c['services'] if s['name']=='$name'))")"
  image="${name}:${TAG_PLAT}"
  tar_name="${name}-${TAG_PLAT}.tar"
  tar_path="$OUT_DIR/$tar_name"
  work="$(mktemp -d)"
  mkdir -p "$work/seed"
  echo "==> go build $name linux/$GOARCH"
  ( cd "$ROOT/$name" && CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" go build -ldflags="-s -w" -o "$work/main" . )
  cp "$ROOT/$name/manifest/config/config.example.yaml" "$work/config.yaml"
  if [[ -d "$ROOT/$name/manifest/etcd-seed" ]]; then
    cp -a "$ROOT/$name/manifest/etcd-seed/." "$work/seed/"
  fi
  echo "==> docker build $image ($PLATFORM)"
  docker build --platform "$PLATFORM" -t "$image" -f "$RUNTIME" "$work"
  echo "==> save $tar_path"
  docker save "$image" -o "$tar_path"
  python3 - "$OUT_DIR/${name}-${TAG_PLAT}.json" "$name" "$image" "$PLATFORM" "$port" "$tar_name" "$tar_path" <<'PY'
import json, os, sys, datetime
out, name, image, platform, port, tar_name, tar_path = sys.argv[1:]
meta = {
  "service": name, "image": image, "platform": platform,
  "containerPort": int(port), "tar": tar_name,
  "sizeBytes": os.path.getsize(tar_path),
  "builtAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
}
open(out, "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=2))
PY
  rm -rf "$work"
  echo "    $tar_name"
done
echo "完成: $OUT_DIR"
