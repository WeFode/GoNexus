# etcd RBAC —— 双账号轻量方案
#
# 设计取舍：
#   管理面（谁能在 Web 上改配置/发布）由达梦 AUTH_USERS 表 + JWT 负责，不在 etcd 层做。
#   etcd 层只做纵深防御：config-admin（配置中心服务进程，读写）+ config-reader（所有微服务只读）。
#   不按服务细分 etcd 账号——几百个服务每个建用户/角色的运维成本远大于收益；
#   只读账号已能防住"单个服务进程被攻破后篡改全局配置"这一主要风险。
#
# 1. 开启认证前必须先有 root，否则会把自己锁在外面。
# 2. 本脚本默认对接 docker 容器 gf_etcd；本地开发可不执行（无认证）。
# 用法：
#   ETCD_ROOT_PASS=... bash scripts/etcd-rbac.sh
#
# 执行后：
#   configure-server config.yaml 增加并使用：
#     svc.etcd.username: config-admin / svc.etcd.password: <ADMIN_PASS>
#   各微服务 config.yaml（或发布模板）增加：
#     svc.etcd.username: config-reader / svc.etcd.password: <READER_PASS>

set -euo pipefail

ETCD_CONTAINER="${ETCD_CONTAINER:-gf_etcd}"
ETCD_ENDPOINTS="${ETCD_ENDPOINTS:-http://127.0.0.1:2379}"
ROOT_USER="${ETCD_ROOT_USER:-root}"
ROOT_PASS="${ETCD_ROOT_PASS:-RootPassword123}"
ADMIN_USER="${ETCD_ADMIN_USER:-config-admin}"
ADMIN_PASS="${ETCD_ADMIN_PASS:-AdminPass456}"
READER_USER="${ETCD_READER_USER:-config-reader}"
READER_PASS="${ETCD_READER_PASS:-ReaderPass789}"
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

echo "==> config-admin: readwrite ${PREFIX}/ (configure-server 进程使用)"
ctl "${auth[@]}" role add config-admin-role || true
ctl "${auth[@]}" role grant-permission config-admin-role --prefix=true readwrite "${PREFIX}/"
ctl "${auth[@]}" user add "${ADMIN_USER}:${ADMIN_PASS}" || true
ctl "${auth[@]}" user grant-role "${ADMIN_USER}" config-admin-role

echo "==> config-reader: readonly ${PREFIX}/ (所有微服务 SDK 共用)"
ctl "${auth[@]}" role add config-reader-role || true
ctl "${auth[@]}" role grant-permission config-reader-role --prefix=true read "${PREFIX}/"
ctl "${auth[@]}" user add "${READER_USER}:${READER_PASS}" || true
ctl "${auth[@]}" user grant-role "${READER_USER}" config-reader-role

echo ""
echo "完成。configure-server 用 ${ADMIN_USER} 写入；微服务统一用 ${READER_USER} 只读。"
echo "configure-server:      svc.etcd.username=${ADMIN_USER}"
echo "services (shop-server): svc.etcd.username=${READER_USER}"
