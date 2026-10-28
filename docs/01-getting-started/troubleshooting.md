# 常见问题

按现象查。报错原文来自代码里的实际字符串，可直接搜索。

## 配置热更新

### 改了 database 连接串，为什么 DB 还连旧库？

连接池在**启动时**建立，热重载只更新 `g.Cfg()` 的内存快照。换 DSN 必须滚动重启；或者把 `database` 加进 `stickyKeys`，让它明确不参与热重载，避免误以为能生效。

同理，改 `server.address` 不会改监听端口——进程不会重绑。见 [etcdcfg SDK](../02-reference/etcdcfg-sdk.md#热重载的边界)。

### `test` / `logger` 这些改了也不生效？

检查有没有把它们列进 `svc.etcd.stickyKeys`。**不配置 `stickyKeys` 时全部根 key 都是 live 热重载**；配置了的根 key 保持启动时的值，etcd 变更不会写入内存快照。

验证：`GET :8000/api/v1/config/runtime`，返回里的 `stickyKeys`、`reloadedAt`、`changed` 会告诉你最近一次重载动了哪些路径。

### seed 写了 0 个配置

etcd 里已存在同名 key，seed 默认不覆盖（`PutIfAbsent`）。要强制覆盖：

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"force": true}' http://127.0.0.1:9000/api/v1/configs/seed
```

报 `仅管理员可强制覆盖 seed` 说明当前 token 的角色不是 `admin`。

### 启动报 `etcd 未连接，当前使用本地快照`

不是失败，是降级启动。etcd 连不上或首次拉取失败时，Adapter 读 `data/config-cache/<服务>.snapshot.yaml` 起来，探活返回 `configFrom=snapshot`、状态 `degraded`，后台每 5s 重连。

如果**连快照也没有**，启动会直接失败——这就是 `snapshotDir` 在容器部署时必须挂持久卷的原因。

### 报 `本地配置缺少 svc.etcd.host，格式：ip:port@服务名` / `微服务的 svc.etcd.host 必须为 ip:port@服务名`

业务微服务的 `svc.etcd.host` 必须带 `@服务名`；配置中心自己不写 `@`（它是管理端，不消费配置）。多服务同名会互相覆盖配置，服务名不一致则读不到自己的 key。

## 登录与权限

### `未登录`

除 `POST /api/v1/auth/login` 和 `GET /api/v1/health` 外，所有配置接口都要 JWT。前端 `web/src/api/client.ts` 在 HTTP 401 或 `code !== 0` 时会清 token 跳登录页。

### `operator` 参数填了不生效

写配置的 controller **忽略请求体里的 `operator`**，一律取 JWT 登录用户。这是设计如此，防止伪造审计。

### 登录口令改了不生效

`auth.users` 只在 `auth_users` 表**不存在或为空**时兜底。表建好之后登录走表里的 bcrypt 哈希，改 YAML 里的明文口令没有用——要么改表，要么把表清空让首次启动重新初始化。

### 账号被锁

`authx` 有内存级失败锁定：连续 5 次失败锁 10 分钟。重启进程会清空计数（计数不落库）。

### `error obtaining VCS status: exit status 128`

`go build` 默认要打 Git 版本戳；GoLand 若用 Administrator 打开、仓库在别的用户目录下，Git 返回 128。仓库已加 `-buildvcs=false`。GoLand 里：**Settings → Go → Build Tags / Vendoring**，或运行配置的 **Go tool arguments** 填 `-buildvcs=false`，环境变量 `GOFLAGS=-buildvcs=false`。也可选仓库自带的共享运行配置 `configure-server` / `shop-server`。

## 数据库

### 启动日志说审计库未就绪

库表脚本只在 `configure-server/manifest/sql/`，**配置中心进程不执行 DDL**。

- 本地 compose 只在 `gf_pg_data` **空数据卷**时由 `scripts/pg-init/00-init.sh` 自动建 `config_center`（`000`/`001`/`003`/`004`）和 `app_db`（`002`）。
- 卷已存在（或首次初始化失败过）需要手工补：

```bash
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/001_schema.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/003_node_metrics.sql
psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f manifest/sql/pgsql/004_auth_users.sql
```

`000_create_database.sql` 在库已存在时会报错，可忽略后继续跑 `001`（都带 `IF NOT EXISTS`）。

后果只是历史/发布/登录相关接口报错，配置读写不受影响——etcd 才是真相源。

### 换到达梦 DM8

`main.go` 已同时注册 pgsql 和 dm 驱动，**不用改代码**：

1. SYSDBA 执行 `manifest/sql/dm/000_create_user.sql`（按现场改 DATAFILE 路径和口令）。
2. 用 `CONFIG_CENTER` 执行 `dm/001_schema.sql`、`003_node_metrics.sql`、`004_auth_users.sql`。
3. 改 `database.default.link`：

```yaml
database:
  default:
    link: "dm:CONFIG_CENTER:ConfigCenter_123@tcp(127.0.0.1:5236)"
```

列已存在时报错可忽略。表名列名与 pgsql 对齐（达梦用双引号小写），GoFrame ORM 不用改。详见 [数据库表结构](../02-reference/database-schema.md)。

### Postgres 起来又挂掉，日志里有 `$'\r'`

`00-init.sh` 从 Windows 拷过去带 CR。`sed -i 's/\r$//' scripts/pg-init/00-init.sh`，然后**删除数据卷**再 up——初始化失败的卷不会重跑脚本。

## 发布与节点

### 节点页看不到这台机器

三选一：`auth.agentToken` 与探针 `agent.token` 不一致；`agent.server` 不是 `http://127.0.0.1:9000`；systemd 的 `WorkingDirectory` 不是探针目录（导致读不到 `manifest/config/config.yaml`）。

`journalctl -u deploy-agent -f` 里应能看到 `node=<nodeId>`，且没有持续的 `docker info` 报错。

### 报 `节点 xxx 离线，请先在该机器启动 deploy-agent`

节点 `last_seen` 距今超过 **45 秒**（约 4 个心跳周期，`agent.interval` 默认 10s）。看探针进程和它到 9000 的连通性。

### 发布被拒绝，说平台不一致

上传的 tar 文件名不是 `*-linux-arm64.tar`（服务端按文件名解析平台），或探针上报的 `docker_platform` 不是 `linux/arm64`。amd64 的 tar 在 ARM 机器上 `docker load` 后是 `exec format error`。

打包时漏了 `--platform`，Docker Desktop 会按本机架构存成 amd64。检查：

```bash
docker image inspect --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}' shop-server:linux-arm64
```

### `旁路灰度请只选一个节点` / `灰度端口不能与主端口相同`

填了 `canaryHostPort` 就是单节点旁路灰度，只能选一台，且旁路端口不能等于主端口。

### `没有可回滚的上一成功版本`

该节点该服务只有 0 或 1 次 `action=deploy` 且 `status=success` 的记录。回滚需要至少两次成功部署，用倒数第二条的产物。

### `该版本已是当前配置，请选择更早的历史版本`

配置历史里当前版本就是线上内容，回滚它没有意义。

### `没有可推进的灰度任务（无等待节点，也无成功的旁路灰度）`

转正/推进的前提：有 `status=waiting` 的同产物任务，或有 `action=canary` 且 `status=success` 的旁路任务。两者都没有说明这次发布不是灰度，或者金丝雀还没成功。

### 端口冲突 / 容器起不来

本机 `go run` 的 shop-server 会占 8000，这时不要对 `cc-shop-server` 点启动（Docker 同样要抢 8000）。停掉 `go run`，或发布时换宿主机端口。

探针在 `docker run` 失败时会用 `netstat -ano` / `ss -lptn` / `lsof -i` 定位是谁占了端口，把结论写进任务 `message`。

### 容器连不上 etcd / Postgres

探针给容器加 `--add-host host.docker.internal:host-gateway`，并把配置里的 `127.0.0.1` 改写成 `svc.etcd.loopbackAs`（默认 `host.docker.internal`）。容器仍连不上时，确认宿主机端口发布在 `0.0.0.0` 而不是 `127.0.0.1`——`127.0.0.1:5433:5432` 这种写法别的容器访问不到。

### 任务一直 `running` 最后变 `failed`

`running` 超过 `deploy.jobTimeout`（默认 10m）未回写结果，会在该节点下一次心跳时被置为 `failed`。通常是探针下载 tar 慢、或 `docker load` 卡住、或健康探测超时后自动回滚把任务标记为失败。

## 前端

### `npm run dev` 起不来或接口全 401

Vite 把 `/api` 代理到 `http://127.0.0.1:9000`（`web/vite.config.ts`）。先确认配置中心在跑，再重新登录拿新 token。

### 上传大 tar 报 413

`server.clientMaxBodySize` 默认 `512MB`。改配置中心本地 `config.yaml`；生产 nginx 还要同步 `client_max_body_size`。

## 本地端口速查

| 进程 | 地址 |
|------|------|
| configure-server | `:9000` |
| shop-server | `:8000` |
| 中台前端 dev | `:5173` |
| etcd | `2379` / `2380` |
| Postgres | `5433`（容器内 5432） |
| Redis | `6380`（容器内 6379） |
| 达梦 DM8（可选） | `5236` |

## 相关文档

- [内网 ARM64 离线部署](deploy-offline-arm64.md) 的 §11 有离线场景专属的排查表
- [架构与实现链路](../02-reference/architecture.md) 的设计边界一节，解释了上面这些行为为什么是这样
