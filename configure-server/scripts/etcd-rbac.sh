# 1. 开启认证前必须先有 root，否则会把自己锁在外面。
# 2. 本脚本默认对接 docker 容器 gf_etcd；本地开发可不执行（无认证）。
# 用法：
#   ETCD_ROOT_PASS=... SHOP_PASS=... ADMIN_PASS=... bash scripts/etcd-rbac.sh

set -euo pipefail

ETCD_CONTAINER="${ETCD_CONTAINER:-gf_etcd}"
ETCD_ENDPOINTS="${ETCD_ENDPOINTS:-http://127.0.0.1:2379}"
ROOT_USER="${ETCD_ROOT_USER:-root}"
ROOT_PASS="${ETCD_ROOT_PASS:-RootPassword123}"
ADMIN_USER="${ETCD_ADMIN_USER:-config-admin}"
ADMIN_PASS="${ETCD_ADMIN_PASS:-AdminPass456}"
SHOP_USER="${ETCD_SHOP_USER:-shop-user}"
SHOP_PASS="${ETCD_SHOP_PASS:-ShopUserPass456}"
PREFIX="${ETCD_PREFIX:-/config-center}"

ctl() {
  docker exec -e ETCDCTL_API=3 "$ETCD_CONTAINER" etcdctl --endpoints="$ETCD_ENDPOINTS" "$@"
}

echo "==> create root (ignore if exists)"
ctl user add "${ROOT_USER}:${ROOT_PASS}" || true
ctl user grant-role "$ROOT_USER" root || true

echo "==> enable auth"
ctl auth enable || true

auth=(--user="${ROOT_USER}:${ROOT_PASS}")

echo "==> admin role (readwrite whole prefix)"
ctl "${auth[@]}" role add config-admin-role || true
ctl "${auth[@]}" role grant-permission config-admin-role --prefix=true readwrite "${PREFIX}/"
ctl "${auth[@]}" user add "${ADMIN_USER}:${ADMIN_PASS}" || true
ctl "${auth[@]}" user grant-role "$ADMIN_USER" config-admin-role

echo "==> shop-server read-only role"
ctl "${auth[@]}" role add shop-server-role || true
ctl "${auth[@]}" role grant-permission shop-server-role --prefix=true read "${PREFIX}/shared/"
ctl "${auth[@]}" role grant-permission shop-server-role read "${PREFIX}/services/shop-server"
ctl "${auth[@]}" user add "${SHOP_USER}:${SHOP_PASS}" || true
ctl "${auth[@]}" user grant-role "$SHOP_USER" shop-server-role

echo "done."
echo "configure-server: svc.etcd.username=${ADMIN_USER}"
echo "shop-server:      svc.etcd.username=${SHOP_USER}"
