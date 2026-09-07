# 配置中心库表

配置中心的审计/发布表**只维护在本目录**，不再写进 Go 代码。etcd 仍是运行时配置真相源；这里只服务：

| 表 | 用途 |
|----|------|
| `config_history` | 配置发布历史与回滚 |
| `deploy_nodes` | Agent 心跳 |
| `deploy_artifacts` | 镜像 tar 元数据 |
| `deploy_jobs` | 发布任务 |

`pgsql/` 与 `dm/` 表名、列名相同（达梦用双引号小写），GoFrame ORM 不用改。切换数据库只改 `manifest/config/config.yaml` 的 `database.default.link`。

## PostgreSQL（本地 compose 默认）

```powershell
cd configure-server
make docker-up
# 首次创建数据卷时 scripts/pg-init 会建 config_center 并执行 pgsql/*.sql
# 同时执行 shop-server/manifest/sql 到 app_db
```

已有数据卷、需要补表时：

```powershell
psql -U postgres -h 127.0.0.1 -p 5433 -d postgres -f manifest/sql/pgsql/000_create_database.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/001_schema.sql
```

`000_create_database.sql` 在库已存在时会报错，可忽略后继续跑 `001_schema.sql`（`IF NOT EXISTS`）。

连接串：

```yaml
database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/config_center"
```

## 达梦 DM8（信创）

1. SYSDBA 执行 `dm/000_create_user.sql`（按现场改 DATAFILE 路径和口令）。
2. 用 `CONFIG_CENTER` 执行 `dm/001_schema.sql`。
3. 改本地配置（注释掉 pgsql 的 link）：

```yaml
database:
  default:
    link: "dm:CONFIG_CENTER:ConfigCenter_123@tcp(127.0.0.1:5236)"
```

`main.go` 已同时注册 pgsql 与 dm 驱动，不必改代码。进程启动只探测 `config_history` 是否可读，**不会**自动建表。

```text
disql SYSDBA/SYSDBA@127.0.0.1:5236
SQL> start manifest/sql/dm/000_create_user.sql
SQL> exit

disql CONFIG_CENTER/ConfigCenter_123@127.0.0.1:5236
SQL> start manifest/sql/dm/001_schema.sql
```
