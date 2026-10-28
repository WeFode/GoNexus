# 配置中心库表

审计与发布表**只维护在本目录**，不写进 Go 代码。etcd 仍是运行时配置真相源，这里的表只服务：配置历史与回滚、节点心跳、镜像产物、发布任务、登录账户。

**配置中心进程不执行 DDL**，启动时只探测 `config_history` 是否可读，失败仅告警。

完整文档：[数据库表结构](../../../docs/02-reference/database-schema.md) —— 每张表的字段、索引、状态流转、初始化方式与达梦对齐规则。

## 两套脚本

`pgsql/` 与 `dm/` 的库表语义一致：配置中心表 PG 用小写、达梦用双引号大写，代码里写不带引号的小写表名（PG 落到小写、达梦折叠到大写）。`products` 是例外：shop-server 的 DAO 由 CLI 按大写生成，两套脚本都建 `"PRODUCTS"`。GoFrame ORM 不用改代码，切换只改 `manifest/config/config.yaml` 的 `database.default.link`。

| 脚本 | 目标库 | 内容 |
|------|--------|------|
| `000_create_database.sql` / `dm/000_create_user.sql` | `postgres` / SYSDBA | 建 `config_center` 库；达梦建表空间与 `CONFIG_CENTER` 用户 |
| `001_schema.sql` | `config_center` | `config_history`、`deploy_nodes`、`deploy_artifacts`、`deploy_jobs` |
| `002_shop_schema.sql` | `app_db` | `products`（shop-server 示例，与配置中心无关） |
| `003_node_metrics.sql` | `config_center` | 补节点指标列，供发布页推荐节点 |
| `004_auth_users.sql` | `config_center` | `auth_users` 登录账户（bcrypt） |
| `005_deploy_jobs_index.sql` | `config_center` | 补 `deploy_jobs(status, updated_at)` 索引，供老库升级 |

PG 脚本全部带 `IF NOT EXISTS`，可重复执行；DM 的 `ALTER` / `CREATE INDEX` 重复执行会报“已存在”，忽略后继续即可。

## 本地 compose

`make docker-up` 首次创建数据卷时，`scripts/pg-init/00-init.sh` 会建 `config_center`（`001`/`003`/`004`）和 `app_db`（`002`）。

**卷已存在过就不再执行**（哪怕上次初始化失败）。已有库手工补：

```bash
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/001_schema.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/003_node_metrics.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/004_auth_users.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/005_deploy_jobs_index.sql
```

达梦用 `disql`：

```text
disql SYSDBA/SYSDBA@127.0.0.1:5236
SQL> start manifest/sql/dm/000_create_user.sql     -- 先按现场改 DATAFILE 路径和口令

disql CONFIG_CENTER/ConfigCenter_123@127.0.0.1:5236
SQL> start manifest/sql/dm/001_schema.sql
```
