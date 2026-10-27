#!/bin/bash
# Postgres 首次初始化：配置中心库 + shop 业务库。
# 由官方 postgres 镜像在空数据卷时执行（docker-entrypoint-initdb.d）。
set -euo pipefail

psql_cmd() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@"
}

db_exists() {
  psql --username "$POSTGRES_USER" --dbname postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -q 1
}

echo "==> init config_center"
if ! db_exists config_center; then
  psql_cmd --dbname postgres -f /opt/sql/config-center/000_create_database.sql
fi
for f in /opt/sql/config-center/*.sql; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    000_*|002_*) continue ;;
  esac
  echo "    apply $(basename "$f") -> config_center"
  psql_cmd --dbname config_center -f "$f"
done

echo "==> init app_db (shop-server)"
if ! db_exists app_db; then
  psql_cmd --dbname postgres -c "CREATE DATABASE app_db;"
fi
# 002_shop_schema.sql 与业务库在同一目录；/opt/sql/shop 仅兼容旧挂载。
for f in /opt/sql/config-center/002_*.sql /opt/sql/shop/*.sql; do
  [ -e "$f" ] || continue
  echo "    apply $(basename "$f") -> app_db"
  psql_cmd --dbname app_db -f "$f"
done

echo "==> postgres init done"
