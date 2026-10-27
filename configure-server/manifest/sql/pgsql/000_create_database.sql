-- 在维护库 postgres 上执行（不是 config_center 自身）。
-- 本地 compose 由 scripts/pg-init/00-init.sh 在库不存在时调用本文件。
-- 手工：
--   psql -U postgres -h 127.0.0.1 -p 5433 -d postgres -f 000_create_database.sql
CREATE DATABASE config_center;
