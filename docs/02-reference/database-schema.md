# 数据库表结构

配置中心的库表**只维护在** `configure-server/manifest/sql/`，不写进 Go 代码。etcd 仍是运行时配置真相源，这里的表只服务四件事：配置审计与回滚、节点心跳、镜像产物、发布任务，外加登录账户。

## 进程不执行 DDL

`configure-server` 启动时只 `SELECT count(*)` 探测 `config_history` 是否可读（`internal/boot/boot.go` 的 `pingAuditDB`），失败**只打 warning**。

后果是分级降级的：审计表缺失时配置读写仍然正常（走 etcd），只有历史、发布、登录相关接口会报错。这是刻意设计——不要让建表失败阻塞配置中心启动。

## 两套脚本，表名列名对齐

```
manifest/sql/
  pgsql/   000_create_database.sql  001_schema.sql  002_shop_schema.sql  003_node_metrics.sql  004_auth_users.sql
  dm/      000_create_user.sql      001_schema.sql  002_shop_schema.sql  003_node_metrics.sql  004_auth_users.sql
```

达梦用双引号小写保持与 PostgreSQL 相同的表名/列名，**GoFrame ORM 代码不用改**。切换数据库只改 `database.default.link`，见 [配置项字典](configuration.md#database)。

## 两个库

| 库 | 谁用 | 内容 |
|----|------|------|
| `config_center`（达梦 `CONFIG_CENTER`） | configure-server | `config_history`、`deploy_nodes`、`deploy_artifacts`、`deploy_jobs`、`auth_users` |
| `app_db` | shop-server | `"PRODUCTS"`（脚手架示例） |

业务库的 DSN 来自 etcd `shared/database`，**不在配置中心的本地配置里**。

## 表

### `config_history` —— 配置发布审计

只增不改。每次 etcd 写成功后追加一条；回滚读这里。

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGSERIAL PK | |
| `config_key` | VARCHAR(255) | etcd 全路径，如 `/config-center/services/shop-server` |
| `version` | INT | 递增版本号，`MAX(version) + 1` |
| `content` | TEXT | **该版本当下的完整 YAML**（留快照，不存 diff） |
| `action_type` | VARCHAR(16) | `CREATE` \| `UPDATE` \| `BASELINE` \| `DELETE` \| `ROLLBACK` |
| `operator` | VARCHAR(64) | 取自 JWT 登录名，不取请求体 |
| `remark` | VARCHAR(255) | 变更说明 |
| `created_at` | TIMESTAMPTZ | |

索引：`(config_key, version DESC)` 普通索引 + `(config_key, version)` **唯一**索引。

`BASELINE` 是最容易看错的一种：首次修改某个 key 前，服务端会把**修改前**的值补录成一条 `BASELINE`，这样历史的第一条不是「新值」而是「原来是什么」。同一次保存里它和 `UPDATE` 是两条记录。

回滚语义：回滚是**一次新的发布**，追加 `action_type=ROLLBACK` 的新版本号，不是删除记录也不是时光倒流。当前版本不能回滚。

### `deploy_nodes` —— 节点心跳

主键 `node_id`，由 Agent 每次心跳 upsert 覆盖。

| 列 | 类型 | 说明 |
|----|------|------|
| `node_id` | VARCHAR(64) PK | 探针 `agent.nodeId` |
| `hostname` `os` `arch` | | 节点身份 |
| `docker_platform` | VARCHAR(64) | `docker info` 的 `Os/Architecture`，发布时与产物平台比对 |
| `docker_network` `loopback_as` | | 下发容器时用 |
| `ncpu` | INT | 核数（cgroup 限额会夹住） |
| `memory_bytes` | BIGINT | 总内存 |
| `cpu_used_percent` | DOUBLE PRECISION | 默认 **`-1` = 未上报**，不是 0% |
| `memory_used_bytes` | BIGINT | 默认 **`-1` = 未上报** |
| `memory_source` | VARCHAR(16) | `host` = 整机内存；`containers` = 仅本中心容器合计（取不到整机数据时的回退） |
| `host_ports` | TEXT | 运行中容器已发布的宿主机端口，JSON 数组 |
| `agent_version` | VARCHAR(32) | |
| `containers` | TEXT | `cc-*` 容器列表 JSON |
| `last_seen` | TIMESTAMPTZ | **在线判定：距今 < 45 秒** |

`-1` 表示「探针没上报这项」是刻意的：把未上报当成 0% 空闲，节点推荐会把数据缺失的机器排在最前面。`003_node_metrics.sql` 是给已有库补这四列的，`ADD COLUMN IF NOT EXISTS`，可重复执行。

### `deploy_artifacts` —— 镜像产物元数据

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGSERIAL PK | |
| `service_name` | VARCHAR(128) | |
| `image_name` | VARCHAR(255) | 如 `shop-server:linux-arm64` |
| `platform` | VARCHAR(64) | 如 `linux/arm64`，与节点 `docker_platform` 必须匹配 |
| `container_port` | INT | `hostPort` 未填时用它 |
| `file_path` | VARCHAR(512) | 磁盘路径，tar **不落库** |
| `file_size` | BIGINT | |
| `sha256` | VARCHAR(64) | 上传时计算 |
| `operator` | VARCHAR(64) | |
| `created_at` | TIMESTAMPTZ | |

tar 本体在 `deploy.artifactDir`（默认 `data/artifacts`）下，命名 `<id>-<service>.tar`。

### `deploy_jobs` —— 发布任务

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGSERIAL PK | |
| `node_id` | VARCHAR(64) | |
| `artifact_id` | BIGINT | |
| `service_name` | VARCHAR(128) | |
| `action` | VARCHAR(16) | `deploy` \| `rollback` \| `canary` \| `start` \| `stop` \| `restart` \| `stop-canary` |
| `status` | VARCHAR(16) | `waiting` \| `pending` \| `running` \| `success` \| `failed` |
| `image_name` | VARCHAR(255) | |
| `host_port` | INT | |
| `docker_network` `loopback_as` | | 从节点表带下来，Agent 不用二次查询 |
| `message` | TEXT | 建任务时是 `remark`，回写后是 Agent 的结果说明 |
| `operator` | VARCHAR(64) | |
| `created_at` `updated_at` | TIMESTAMPTZ | |

索引 `(node_id, status, id)`——心跳领任务是按节点查 `pending`；`(status, updated_at)`——`reclaimStaleJobs` 按状态 + 时间回收超时任务。

状态流转：

```
                  canary 多节点策略的其余节点
                          ↓
                      waiting ──Promote──┐
                                        ↓
新建 ──→ pending ──Agent 领取──→ running ──→ success
                                    ↑           
                          jobTimeout 超时 → failed
```

- 一次心跳最多派 5 条 `pending`；同节点已有 `running` 时**不派新活**。
- `running` 超过 `deploy.jobTimeout`（默认 10m）未回写，会在该节点下次心跳时被 `reclaimStaleJobs` 置为 `failed`。
- `action=canary` + `canaryHostPort` 是旁路灰度，容器名 `cc-<服务>-canary`，不动主容器。
- 回滚的实现是「取该节点该服务最近两次 `action=deploy` 且 `status=success` 的任务，用倒数第二条的产物再发一次」，然后把新任务 `action` 改成 `rollback`。

### `auth_users` —— 登录账户

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGSERIAL PK | |
| `username` | VARCHAR(64) UNIQUE | |
| `password_hash` | VARCHAR(128) | bcrypt，**不存明文** |
| `role` | VARCHAR(16) | 默认 `operator`；`admin` 才能强制 seed |
| `enabled` | SMALLINT | 默认 1 |
| `created_at` `last_login` | TIMESTAMP | |

建表后登录**优先走这张表**；表为空时首次启动用本地 `auth.users` 初始化写入。表不存在时回退用静态账户。所以：改了 YAML 里的口令却不生效，多半是因为这张表已经存在并接管了认证。

失败锁定（5 次 / 10 分钟）计数在**内存**里，不落库，重启进程即清零。

### `"PRODUCTS"` —— 业务示例表

在 `app_db`，不是 `config_center`。表名与列名使用**大写 + 双引号**，与达梦脚本和 `shop-server/internal/dao` 的 DAO 保持一致（PG 不引用大写标识会折叠成小写，DAO 会查不到）。

| 列 | 类型 | 说明 |
|----|------|------|
| `ID` | BIGSERIAL PK | |
| `NAME` | VARCHAR(128) | 索引 |
| `DESCRIPTION` | TEXT | |
| `PRICE` | NUMERIC(12,2) | |
| `STOCK` | INT | |
| `STATUS` | SMALLINT | 1=上架 0=下架，索引 |
| `CREATED_AT` `UPDATED_AT` | TIMESTAMPTZ | |

`002_shop_schema.sql` 还带两行示例商品数据（`pgcrypto` 扩展只为脚手架里的默认值服务），生产可以删。这张表**与配置中心无关**，删掉它配置中心照常工作。

> 旧的 PG 数据卷如果还是小写 `products`，不会自动升级：删卷重建，或按 `pgsql/002_shop_schema.sql` 手工迁移表名与列名。

## 初始化

### 本地 compose（自动）

`configure-server/docker-compose.yml` 把两个目录挂进 Postgres 容器：

```yaml
volumes:
  - ./scripts/pg-init:/docker-entrypoint-initdb.d:ro
  - ./manifest/sql/pgsql:/opt/sql/config-center:ro
```

官方 postgres 镜像**只在数据卷为空时**执行 `scripts/pg-init/00-init.sh`，它做两件事：`config_center` 不存在时跑 `000_create_database.sql`，然后对 `001`/`003`/`004` 逐个执行（**跳过 `000` 和 `002`**）；再建 `app_db` 并执行 `002_shop_schema.sql`。

> 卷已经存在过（哪怕上次初始化失败），脚本不会再跑。这是「起不来又查不出原因」的头号来源。

### 手工补表

```bash
# 建库（库已存在会报错，可忽略后继续）
psql -U postgres -h 127.0.0.1 -p 5433 -d postgres -f manifest/sql/pgsql/000_create_database.sql

psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/001_schema.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/003_node_metrics.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/004_auth_users.sql
```

全部带 `IF NOT EXISTS`，可重复执行。已有库补节点指标列只跑 `003` 即可。

### 达梦 DM8

```bash
disql SYSDBA/SYSDBA@127.0.0.1:5236
SQL> start manifest/sql/dm/000_create_user.sql     -- 先改 DATAFILE 路径和口令
SQL> exit

disql CONFIG_CENTER/ConfigCenter_123@127.0.0.1:5236
SQL> start manifest/sql/pgsql/../dm/001_schema.sql
SQL> start manifest/sql/dm/003_node_metrics.sql
SQL> start manifest/sql/dm/004_auth_users.sql
SQL> start manifest/sql/dm/005_deploy_jobs_index.sql
```

`000_create_user.sql` 会建表空间 `CONFIG_CENTER_DATA` 和用户 `CONFIG_CENTER`，授予 `RESOURCE, PUBLIC, VTI, SOI` 与建表/视图/索引/序列权限。**按现场改路径和口令后再执行**。

## DAO 代码生成

`internal/dao` 与 `internal/model/{do,entity}` 由 GoFrame CLI 生成，配置在 `configure-server/hack/config.yaml`：

```yaml
gfcli:
  gen:
    dao:
      - link: "dm:CONFIG_CENTER:ConfigCenter_123@tcp(127.0.0.1:5236)/CONFIG_CENTER"
        descriptionTag: true
        tables: "CONFIG_HISTORY,DEPLOY_NODES,DEPLOY_ARTIFACTS,DEPLOY_JOBS"
        jsonCase: "Snake"
```

`make gen`（= `gf gen dao && gf gen ctrl && gf gen service`）会按这份配置重新生成。注意 `link` 当前指向达梦，用 Postgres 环境时把它换成上面注释掉的那行 pgsql 连接串，否则生成的实体标签会带达梦的列注释。

`auth_users` 不在 `tables` 列表里——它由 `utility/authx` 直接用 SQL 访问，没有生成的 DAO。

## 相关文档

- [HTTP API 参考](api.md) —— 读写这些表的接口
- [架构与实现链路](architecture.md) §8 —— 数据落在 etcd / Postgres / 磁盘的分工
- [deploy-agent](deploy-agent.md) —— 心跳怎么写 `deploy_nodes`
