# 实现逻辑与代码解读

`README.md` 说明**怎么用**。本文说明**整条链路怎么跑通**：进程先后顺序、调用了哪些工具/依赖/API、代码文件如何互相引用。内网 Linux ARM64、不能访问镜像仓库时的离线步骤见 [§11](#11-内网-linux-arm64-离线部署)。

两条业务链路互相独立，只在「服务名」上对齐：

| 链路 | 真相源 | 作用 |
|------|--------|------|
| **配置热更新** | etcd | 中台改 YAML → etcd Put → 微服务 Watch → 内存 `g.Cfg()` 更新 |
| **镜像发布** | Postgres 任务表 + 磁盘 tar | 中台下发 job → Agent `docker load/run`。不经过 etcd |

配置变更**不需要**重新发镜像；发镜像**不会**改 etcd 里的业务配置。容器启动时 Agent 只写入本地 `svc.etcd.host`，真正的 `server` / `database` / `redis` 仍从 etcd 拉。

---

## 1. 运行时拓扑

```
浏览器 :5173 (Vite)
    │  /api → 代理
    ▼
configure-server :9000          deploy-agent (本机循环)
    │ JWT 写配置 / 建发布任务         │ X-Agent-Token
    │ 管理端 etcd Client              │ docker CLI
    ▼                                 ▼
etcd :2379  ◄──── Watch/Get ────  shop-server :8000（或容器 cc-shop-server）
    ▲                                 │
    │ Seed / CRUD                     ├─ g.DB()  → Postgres :5433 / app_db
    │                                 └─ g.Redis() → Redis :6380
Postgres :5433
    ├─ config_center   （审计 + 发布表，configure-server 用）
    └─ app_db          （shop-server 业务库）
```

开发环境基础设施由 `configure-server/docker-compose.yml` 拉起（`make docker-up`）：

| 容器 | 镜像 | 宿主机端口 | 用途 |
|------|------|------------|------|
| `gf_etcd` | `quay.io/coreos/etcd:v3.5.21` | 2379 / 2380 | 配置真相源 |
| `gf_postgres` | `postgres:16-alpine` | 5433→5432 | 审计库 + shop 业务库 |
| `gf_redis` | `redis:7-alpine` | 6380→6379 | shop 缓存（可选） |

compose 把 `configure-server/manifest/sql/pgsql` 交给 `scripts/pg-init`：首次建卷时创建 `config_center`（`001`、`003`）和 `app_db`（`002_shop_schema.sql`）。**配置中心进程不再执行 DDL**。信创达梦脚本在 `manifest/sql/dm/`。

---

## 2. 工具与依赖

### 2.1 开发/运行时工具

| 工具 | 谁调用 | 做什么 |
|------|--------|--------|
| **Go 1.25+** | 各 `go run` / `package.ps1` | 编译微服务与配置中心 |
| **Docker Desktop** | compose、Agent、`package.ps1` | 基础设施、`docker load/run`、打 scratch 镜像 |
| **etcdctl** | `scripts/etcd-rbac.sh`（生产可选） | 开 auth、给微服务只读角色 |
| **Node.js + npm** | `web/` | Vite 开发服务器、antd 中台 |
| **PowerShell / bash** | `package.ps1` / `package.sh` | 交叉编译 + `docker save` 出 tar |

Agent **不**用 Docker SDK，只 `exec.Command("docker", ...)`（`deploy-agent/internal/dockerx/docker.go`）。

### 2.2 Go 模块（`go.work`）

```
go.work
  ./pkg/etcdcfg          共用 SDK
  ./configure-server     配置中心
  ./shop-server          示例微服务
  ./deploy-agent         节点 Agent
```

| 模块 | 直接依赖 | 用途 |
|------|----------|------|
| `pkg/etcdcfg` | `github.com/gogf/gf/v2`、`go.etcd.io/etcd/client/v3` | 实现 `gcfg.Adapter`；etcd Get/Put/Watch/Txn |
| `configure-server` | `etcdcfg`、`gf/v2`、`gf/contrib/drivers/pgsql/v2`、`golang-jwt/jwt/v5`、`golang.org/x/crypto`（bcrypt） | HTTP API、JWT、Postgres 审计/发布 |
| `shop-server` | `etcdcfg`、`gf/v2`、pgsql 驱动、`gf/contrib/nosql/redis/v2` | 业务 API；配置全部走 Adapter |
| `deploy-agent` | `gf/v2`（只用来读本地 yaml / 打日志） | 心跳、拉 tar、调 docker CLI |

`pkg/etcdcfg` **静态编译进** shop-server / 其它微服务二进制，镜像里没有单独的 `pkg/` 目录。

configure-server **不用** `etcdcfg.Boot` 替换自己的 `g.Cfg()`。它的 HTTP 端口、JWT、Postgres DSN 仍在本地 `manifest/config/config.yaml`。它只用 `etcdcfg.NewClient` 当 **etcd 管理员客户端**。

### 2.3 前端依赖（`web/package.json`）

| 包 | 用途 |
|----|------|
| React 19 + react-router-dom 7 | 页面与路由 |
| antd 6 + @ant-design/icons | 中台 UI |
| Vite 7 + @vitejs/plugin-react | 开发与打包 |
| Tailwind 4（`@tailwindcss/vite`，无 preflight） | 间距/排版，不覆盖 antd |
| dayjs | 时间（antd 依赖） |

浏览器 **只** 调 configure-server。Vite 把 `/api` 代理到 `http://127.0.0.1:9000`（`web/vite.config.ts`）。前端从不直连 etcd。

---

## 3. GoFrame 分层与文件约定

configure-server / shop-server 都按 GoFrame 官方分层：

```
api/<域>/v1/*.go          请求/响应 + g.Meta 路由（OpenAPI）
internal/controller/      薄封装：校验/鉴权上下文 → service
internal/service/*.go     接口定义 + RegisterXxx（Ioc）
internal/logic/<域>/      真正实现；包 init() 里 Register
internal/cmd/cmd.go       启动：Boot → 绑路由 → s.Run()
internal/boot/            仅 configure-server：JWT、建表、etcd client、seed
utility/                  与业务无关的包（etcdx、authx）
manifest/config/          本地引导配置（GoFrame 默认搜索路径）
```

`main.go` 的 **空白 import 顺序就是隐式初始化顺序**，必须先于 `cmd.Main.Run`：

```
_ internal/packed          把 manifest/config 打进二进制（gf pack）
_ pgsql/redis 驱动         注册 g.DB / g.Redis 的底层驱动
_ internal/logic           触发 logic/*/init → service.Register*
然后 cmd.Main.Run
```

业务代码禁止在 `init()` 里连 etcd。微服务在 **cmd 函数体**里调用 `etcdcfg.Boot`，且必须在第一次 `g.Server()` / `g.DB()` / `g.Redis()` 之前。

HTTP 统一响应由 `ghttp.MiddlewareHandlerResponse` 包成 `{code, message, data}`。前端 `web/src/api/client.ts` 按这个结构解析；`code !== 0` 或 HTTP 401 则清 token 跳登录。

---

## 4. 链路 A：配置热更新（核心）

### 4.1 启动先后（开发）

1. `cd configure-server && make docker-up` → etcd / Postgres / Redis
2. `make run` → configure-server
3. `cd shop-server && make run` → 微服务
4. `cd web && npm run dev` → 中台（可选，改配置也可用 curl/Swagger）

没有 1，步骤 2 连不上 etcd 会启动失败。没有 2 的 seed，步骤 3 若 etcd 空且无磁盘快照会启动失败。

### 4.2 configure-server 启动顺序

文件调用链：

```
configure-server/main.go
  packed + pgsql/dm 驱动 + logic 空白 import
  cmd.Main.Run
    └─ internal/cmd/cmd.go
         ① boot.Init
         ② g.Server() 绑中间件与 controller
         ③ s.Run() 监听 :9000
```

`internal/boot/boot.go` 内部顺序：

1. **`authx.Init`**（`utility/authx/authx.go`）  
   读本地 `auth.jwtSecret` / `auth.users` / `auth.expire`，bcrypt 哈希密码，供登录签发 JWT。
2. **`pingAuditDB`**  
   `SELECT count` 探测 `config_history` 是否可读。库表由 `manifest/sql/pgsql`（compose 首次初始化）或 `manifest/sql/dm`（信创手工/disql）创建，**启动代码不建表**。失败只打 warning，历史/发布接口会报错。
3. **`etcdcfg.NewClient`**（不是 Boot）  
   本地 `svc.etcd.host` 形如 `127.0.0.1:2379`（**没有** `@服务名`，因为它不是消费者）。  
   底层：`clientv3.New` + `Status` ping。成功后 `etcdx.Set(client)` 放到进程单例。
4. **`service.Config().Seed`**  
   扫描 `manifest/etcd-seed/shared/*.yaml` 与 `services/*.yaml`，`PutIfAbsent` 写入 etcd（已存在则跳过）。每条成功写入附带一条 `config_history`。

logic 注册发生在 boot 之前（空白 import）：

- `internal/logic/logic.go` → `_ config` + `_ deploy`
- `internal/logic/config/config.go` 的 `init()` → `service.RegisterConfig`
- `internal/logic/deploy/deploy.go` 的 `init()` → `service.RegisterDeploy`

路由（`internal/cmd/cmd.go`）：

- 全局 `middleware.CORS`
- `/api/v1` + `middleware.JWT`：Agent 下载体走这里（原始文件流，不用 HandlerResponse）
- `/api/v1` + `JWT` + `MiddlewareHandlerResponse`：Bind health / auth / config / deploy

JWT 中间件（`internal/middleware/auth.go`）分流：

| 路径 | 鉴权 |
|------|------|
| `POST /api/v1/auth/login`、`GET /api/v1/health` | 公开 |
| `/api/v1/agent/*` | 头 `X-Agent-Token` 或 `Authorization: Bearer` 对上 `auth.agentToken` |
| 其它 | `Authorization: Bearer <JWT>`，用户名/角色写入 ctx |

写配置时 controller **忽略**请求体里的 `operator`，用 ctx 里的登录名（`internal/controller/config/config_v1.go` 的 `audit()`）。强制 seed 要求 `role=admin`。

### 4.3 中台改一条配置时发生什么

以编辑 `shop-server` 为例：

```
ServicesPage
  → ConfigListPage 点保存
  → putService()                    web/src/api/config.ts
  → fetch PUT /api/v1/configs/services/shop-server
  → Vite proxy → :9000
  → middleware.JWT
  → controller/config.PutService
  → service.Config().PutService     接口
  → logic/config.PutService
       1. etcdx.Client().GetService  判断 CREATE / UPDATE
       2. etcdx.Client().PutService  → etcdcfg.Client.Put
            yamlToMap 校验 YAML
            clientv3.Put("/config-center/services/shop-server", yaml)
       3. recordHistory              g.DB().Insert config_history
```

etcd Put 成功后，**所有**正在 Watch 该 key 的微服务在约 150ms 防抖后拉一次合并配置。Postgres 失败只记日志，**不会回滚 etcd**（etcd 是真相源）。

预览合并：`GET /configs/preview/{name}` → `Client.LoadMergedYAML`，与微服务启动时同一套 `deepMerge`。

回滚：`POST /configs/rollback` 从 `config_history` 取出旧 YAML，再 `etcd Put` + 新插一条 `action_type=ROLLBACK`（新版本号，不是时光倒流）。

### 4.4 shop-server 启动与读配置

```
shop-server/main.go
  packed + pgsql + redis 驱动 + logic/product
  cmd.Main.Run
    └─ internal/cmd/cmd.go
         ① etcdcfg.Boot(ctx)          必须最先
         ② g.Server() 绑路由
         ③ s.Run() 此时 server.address 已来自 etcd
```

`etcdcfg.Boot` → `BootFromLocal`（`pkg/etcdcfg/boot.go`）：

1. 用 **文件 Adapter**（GoFrame 默认）读本地 `svc.etcd.*`
2. `ParseHost`：`127.0.0.1:2379@shop-server` → endpoints + serviceName
3. `NewAdapter`（`adapter.go`）  
   - `NewClient` 连 etcd  
   - 失败则 `loadFromSnapshot()` 读 `data/config-cache/shop-server.snapshot.yaml`，`source=snapshot`，后台每 5s `startReconnect`  
   - 成功则 `reload()`：`LoadMerged` → `applyLoopback` → 原子写快照 → `g.Cfg().SetAdapter(adapter)`  
   - `watch=true` 时 `startWatch`

`LoadMerged`（`client.go`）：

1. `Get` 前缀 `/config-center/shared/` 下所有 key，按文件名顺序 **深层合并**
2. 再 `Get` `/config-center/services/shop-server`，覆盖同名项
3. 结果是一张 map，同时满足 GoFrame `g.Cfg().Get("database.default.link")`

之后第一次 `g.DB()` / `g.Redis()` / `g.Server()` 都读这张内存 map。连接池和监听端口在此时建立；**之后热更新不会重建它们**。

`etcdcfg.BindHealth(group)` 挂 `GET /api/v1/health`（`pkg/etcdcfg/health.go` → `Probe`）：etcd ping + `configFrom`；合并配置里有 `database` / `redis` 根 key 才探测。

业务示例：`g.Cfg().MustGet(ctx, "test.shopName")` 在 `internal/controller/config/config_v1.go`，每次请求即时读取，用来验证热更新。商品 CRUD 走 `controller/product` → `service.Product` → `logic/product` → `dao` → `g.DB()`。

### 4.5 Watch 热更新（微服务进程内）

```
startWatch
  ├─ goroutine watchLoop(shared 前缀, WithPrefix)
  ├─ goroutine watchLoop(本服务精确 key)
  └─ goroutine debounceLoop（150ms）
```

etcd 事件 → `notify` channel → 防抖合并一批 key → `reload(eventKeys)`：

1. `shouldSkipReload`：若所有事件都是 sticky 的 **shared** 名，跳过拉取
2. 再 `LoadMerged` + loopback 改写 + 写磁盘快照（快照是 **未 sticky** 的完整合并结果，供下次冷启动）
3. `applySticky`：sticky 根 key 保留内存旧值
4. 替换 `Adapter.value`；`g.Cfg().Get` 下次读到新值

Watch 拆成「shared 前缀 + 服务精确 key」是为了生产 etcd RBAC：微服务账号不能 `Watch /config-center/` 整棵树（见 `configure-server/scripts/etcd-rbac.sh`）。

`loopbackAs`：Agent 写入容器内 config.yaml。合并结果里所有 `127.0.0.1` 替换成 `host.docker.internal`，容器才能访问宿主机上的 etcd/Postgres/Redis。

### 4.6 `pkg/etcdcfg` 文件职责

| 文件 | 职责 |
|------|------|
| `boot.go` | `Boot` / `BootFromLocal`：读本地 host，切换 `g.Cfg()` |
| `host.go` | 解析 `ip:port[,ip:port]@服务名` |
| `keys.go` | `/config-center/shared/{name}`、`/services/{name}` |
| `client.go` | etcd CRUD、Txn PutIfAbsent、LoadMerged |
| `merge.go` | YAML↔map、deepMerge、sticky、loopback |
| `diff.go` | 变更路径、skipReload 判断 |
| `snapshot.go` | 固定文件名、临时文件 rename 原子写 |
| `adapter.go` | `gcfg.Adapter`：Get/Data、Watch、重连 |
| `current.go` | `Current()` / `Runtime()` |
| `probe.go` / `health.go` | 统一探活，供任意 GoFrame 服务 Bind |

etcd 协议：gRPC（`clientv3`），不是 HTTP。微服务 **直连 etcd**，configure-server 不在热更新数据面。

---

## 5. 链路 B：中台登录与页面

```
web/src/main.tsx
  → App.tsx
       AuthProvider          启动时若有 token 则 GET /auth/me
       BrowserRouter
         /login              LoginPage → POST /auth/login
         RequireAuth         无 token 跳 /login
           AdminLayout
             /               OverviewPage
             /shared         SharedPage → ConfigListPage
             /services       ServicesPage → ConfigListPage + 接入指引
             /nodes          NodesPage
             /deploys        DeploysPage
```

登录：

```
POST /api/v1/auth/login
  controller/auth
  → authx.Login（bcrypt + HS256 JWT）
  → { token, expireAt, username, role }
web：session.ts 存 localStorage
之后 request() 自动带 Authorization: Bearer
```

页面与 API 对应：

| 页面 | 前端模块 | 后端 API |
|------|----------|----------|
| 登录 | `api/auth.ts` | `/auth/login` `/auth/me` |
| 概览 | `api/config.ts` + `api/deploy.ts` | `/health` 配置条数 `/nodes` |
| 公共/服务配置 | `api/config.ts` | `/configs/shared*` `/configs/services*` `/preview` `/history` `/rollback` `/seed` |
| 节点 | `api/deploy.ts` | `GET /nodes` |
| 发布 | `api/deploy.ts` | `/artifacts` `/deploys` `/deploys/rollback` |

YAML 编辑器是 `components/YamlEditor.tsx`。历史对比在 `HistoryDrawer.tsx`。GoFrame 接入片段在 `onboard/snippets.ts`，由服务配置页抽屉展示。

---

## 6. 链路 C：打包与 Agent 发布

与配置 Watch **无关**。目标：不 SSH，中台把 tar 推到节点上 `docker load` + `docker run`。

### 6.1 打包（开发机）

```
package.ps1
  读 deploy/catalog.json
  对本机 Go：GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build
  复制 config.example.yaml + etcd-seed（若有）
  docker build -f deploy/runtime.Dockerfile   # FROM scratch
  docker save → deploy/dist/<name>-linux-amd64.tar
```

`runtime.Dockerfile` 产物只有 `/app/main`、引导 `config.yaml`、可选 seed。`pkg/etcdcfg` 已在 `go build` 时链进 `main`。

### 6.2 上传与下发

```
DeploysPage 选 tar
  → POST /api/v1/artifacts  multipart
  → controller/deploy.UploadArtifact
  → logic/deploy.SaveArtifact
       落盘 data/artifacts/<id>-<service>.tar
       sha256
       INSERT deploy_artifacts

点发布
  → POST /api/v1/deploys { nodeIds, artifactId, hostPort }
  → CreateDeploy
       节点 last_seen < 45s 否则拒绝
       产物 platform 与节点 docker_platform 必须匹配
       INSERT deploy_jobs status=pending
```

一次只选一个节点 = 人工灰度；成功后再发下一台。回滚：找该节点该服务最近两次 **success** 的 deploy，用倒数第二条的 `artifact_id` 再走 `CreateDeploy`，并把 action 标成 `rollback`。

### 6.3 Agent 循环（`deploy-agent/main.go`）

默认 `agent.interval=10s`：

1. `docker info` / `docker ps -a --filter name=cc-`（`dockerx`），并采集整机 CPU、已用内存、已发布宿主机端口
2. `POST /api/v1/agent/heartbeat` + `X-Agent-Token`（`metrics` 缺省时服务端记为未上报，不当成 0% 占用）
3. 服务端：只把 `cc-*` 容器写入 `deploy_nodes`；若该节点已有 `running` job 则不派新活；否则取出最多 5 条 `pending`
4. Agent 对每条 job：`report(running)` → `GET /agent/artifacts/{id}/file` → `docker load` → 写实例 `config.yaml`（含 `loopbackAs`）→ `docker rm -f cc-<name>` → `docker run` 挂载配置和 snapshot 目录 → `report(success|failed)`
5. 服务端 `reclaimStaleJobs`：`running` 超过 `deploy.jobTimeout`（默认 10m）改为 `failed`

Agent 生成的容器内配置只有 etcd 入口，例如：

```yaml
svc:
  etcd:
    host: "host.docker.internal:2379@shop-server"
    watch: true
    snapshotDir: data/config-cache
    loopbackAs: "host.docker.internal"
```

容器起来后走的仍是 **链路 A**。

节点在线判定：`last_seen` 距今小于 45 秒（约 4 次心跳）。

---

## 7. 数据落在哪

### 7.1 etcd（运行时配置，唯一真相）

前缀默认 `/config-center`（`pkg/etcdcfg/keys.go`）。

| Key | 内容 | 谁写 | 谁读 |
|-----|------|------|------|
| `/config-center/shared/database` | 公共 Postgres DSN 等 | configure-server / seed | 所有微服务 LoadMerged |
| `/config-center/shared/redis` | 公共 Redis | 同上 | 同上 |
| `/config-center/services/shop-server` | `server` / `logger` / `test` 等 | 同上 | 仅 shop-server（及预览 API） |

**没有** `config_info` 表双写。Postgres 挂了，已写入 etcd 的配置对微服务仍然有效。

### 7.2 审计库（PostgreSQL `config_center` 或达梦 `CONFIG_CENTER`）

脚本：`configure-server/manifest/sql/pgsql` 与 `manifest/sql/dm`，表结构对齐，切换只改 `database.default.link`。

| 表 | 用途 |
|----|------|
| `config_history` | 每次 etcd 写成功后追加版本；回滚读这里 |
| `deploy_nodes` | Agent 心跳覆盖；`last_seen` 算在线 |
| `deploy_artifacts` | tar 元数据 + `file_path` |
| `deploy_jobs` | pending → running → success/failed |

shop-server 业务表在 **另一个库** `app_db`（compose 的 `POSTGRES_DB`），DSN 来自 etcd `shared/database`。

### 7.3 本地磁盘

| 路径 | 谁写 | 用途 |
|------|------|------|
| `shop-server/data/config-cache/shop-server.snapshot.yaml` | Adapter 每次成功合并 | etcd 挂了冷启动 |
| `configure-server/data/artifacts/*.tar` | 上传 API | Agent 下载 |
| `deploy-agent/data/instances/<svc>/config/config.yaml` | Agent | 挂进容器只读 |
| `deploy-agent/data/instances/<svc>/cache/` | 容器进程 | 容器内 snapshot |

---

## 8. HTTP API 一览

统一前缀 `/api/v1`。除标注外需 JWT。Agent 接口需 `X-Agent-Token`。

### 鉴权与探活

| 方法 | 路径 | 实现 |
|------|------|------|
| POST | `/auth/login` | `controller/auth` → `authx.Login` |
| GET | `/auth/me` | JWT claims |
| GET | `/health` | `etcdx.Client().Ping`（配置中心自己的，不是 etcdcfg.Probe） |

### 配置

| 方法 | 路径 | logic |
|------|------|-------|
| GET/PUT/DELETE | `/configs/shared/{key}` | etcd List/Get/Put/Delete + history |
| GET/PUT/DELETE | `/configs/services/{name}` | 同上 |
| GET | `/configs/preview/{name}` | `LoadMergedYAML` |
| GET | `/configs/history/{kind}/{key}` | `config_history` |
| POST | `/configs/rollback` | history → etcd Put → 新 history |
| POST | `/configs/seed` | 扫 seed 目录；`force` 仅 admin |

### 发布（控制台 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/nodes` | 心跳表 + 在线计算 + 整机 CPU/内存 |
| GET | `/nodes/recommend?artifactId&hostPort` | 按剩余内存和 CPU 推荐一台可部署节点，并给出每台原因 |
| GET/POST | `/artifacts` | 列表 / 上传 tar |
| GET/POST | `/deploys` | 任务列表 / 创建 pending |
| POST | `/deploys/rollback` | 上一成功产物再发布 |

### Agent

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/agent/heartbeat` | upsert 节点，返回 pending jobs |
| POST | `/agent/jobs/{id}/report` | 更新 job 状态 |
| GET | `/agent/artifacts/{id}/file` | 原始 tar 流（单独一组路由，无 JSON 包装） |

微服务自己的探活（shop-server）：`GET /api/v1/health` 来自 `etcdcfg.BindHealth`；热更新演示：`GET /api/v1/config/runtime`。

---

## 9. 关键文件对照（按调用顺序读）

### 配置中心

```
main.go
internal/packed          # gf 打包本地 yaml
internal/logic/logic.go  # 空白 import 注册
internal/logic/config/config.go
internal/logic/deploy/deploy.go
internal/boot/boot.go
internal/cmd/cmd.go
internal/middleware/auth.go
internal/controller/{auth,config,deploy,health}/
api/{auth,config,deploy,health}/v1/
utility/authx/authx.go
utility/etcdx/etcdx.go   # 进程内 etcd Client 单例
manifest/config/config.yaml
manifest/etcd-seed/      # 启动 seed 源
manifest/sql/pgsql/      # Postgres 建库建表
manifest/sql/dm/         # 达梦信创建用户建表
scripts/pg-init/         # compose 首次初始化调用 pgsql + shop SQL
```

### SDK 与示例服务

```
pkg/etcdcfg/*            # 见 §4.6
shop-server/main.go
shop-server/internal/cmd/cmd.go          # Boot + BindHealth
shop-server/internal/controller/config   # runtime 演示
shop-server/internal/controller/product
shop-server/manifest/config/config.yaml  # 仅 svc.etcd.host
```

### 前端

```
web/src/main.tsx
web/src/App.tsx
web/src/api/{client,auth,config,deploy}.ts
web/src/pages/*
web/vite.config.ts       # /api 代理
```

### 发布

```
deploy/catalog.json
package.ps1 / package.sh
deploy/runtime.Dockerfile
deploy-agent/main.go
deploy-agent/internal/dockerx/docker.go
```

---

## 10. 设计边界（读代码时不要搞混）

1. **etcd = 运行时配置**；Postgres = 审计 + 部署编排。不要把配置再写进 `config_info`。
2. **configure-server 不采集** 各微服务 `/health` 当节点指标。节点状态只来自 Agent 心跳。
3. **热更新只换内存 YAML**，不重绑端口、不重建连接池。换 DSN 要发版滚动，或把 `database` 放进 `stickyKeys` 避免误热更。
4. **服务名四处必须相同**：`svc.etcd.host` 的 `@` 后缀、etcd `services/<名>`、`catalog.json` 的 `name`、容器 `cc-<名>`。
5. **不要把 Boot 放进 `init()`**，否则 `go test` 会连 etcd。
6. 当前 **没有 gRPC 配置通道**；微服务直连 etcd。后续若要鉴权推送，才考虑在 configure-server 加一层，不是接入前提。

新 GoFrame 服务的复制清单见 `examples/gf-service/` 与 `pkg/etcdcfg/README.md`。用法与端口见 `README.md`。

---

## 11. 内网 Linux ARM64 离线部署

目标机是 **Linux ARM64（aarch64）**，不能访问互联网，因此 **不能** `docker pull`。有网的打包机把镜像打成 tar，拷进内网后 `docker load`，再 `docker compose up -d`。etcd、Postgres、Redis、configure-server 都用容器。**deploy-agent 用二进制 + systemd，不要放进 Docker。**

前提：目标机已经装好 Docker Engine 和 `docker compose` 插件（`docker compose version` 能跑）。本文不包含 Docker 引擎本身的离线安装。

### 11.1 探针为什么用 systemd

`deploy-agent` 的工作是替这台机器执行 `docker load` / `docker run`，并上报**整机** CPU、内存和已占用端口（`deploy-agent/internal/dockerx`、`hostmetrics`）。

| | 二进制 + systemd | 再套一层容器 |
|--|--|--|
| `docker` 命令 | 直接用宿主机 CLI | 容器里还得再装一份 CLI，并挂载 `docker.sock` |
| 挂载路径 | Agent 写下的目录就是 dockerd 看到的宿主机路径 | 容器内路径和宿主机路径不一致，业务容器会挂错配置 |
| CPU / 内存 | 读本机 cgroup、`/proc` | 读到的是探针容器自己的配额，节点推荐会失真 |
| 离线物料 | 一个静态二进制，没有基础镜像 | 还要再准备一份 ARM64 镜像 |

用 systemd 把它拉起来即可：Docker 就绪后启动，进程退出自动重启，日志进 `journalctl`。

### 11.2 端口（单机）

| 进程 | 怎么跑 | 地址 |
|------|--------|------|
| etcd | compose `gf_etcd` | 宿主机 `2379` |
| Postgres | compose `gf_postgres` | 宿主机 `5433` → 容器 `5432` |
| Redis | compose `gf_redis` | 宿主机 `6380` → 容器 `6379` |
| configure-server | `docker-compose.app.yml`，`network_mode: host` | `9000` |
| 中台页面 | nginx 容器，同样 host 网络 | `8080`，把 `/api` 转到 `127.0.0.1:9000` |
| shop-server | 稍后由探针 `docker run` | 发布时填的宿主机端口，默认 `8000` |
| deploy-agent | systemd | 无监听端口，主动访问 `127.0.0.1:9000` |

configure-server 走宿主机网络，所以 `manifest/config/config.yaml` 里的 `127.0.0.1` 就是上面这几个宿主机端口。业务容器不走 host 网络：探针会加 `--add-host host.docker.internal:host-gateway`，并把配置里的 `127.0.0.1` 换成 `host.docker.internal`。因此 **5433 / 6380 / 2379 必须发布在 `0.0.0.0`**，不能写成 `127.0.0.1:5433:5432`，否则别的容器访问不到。用防火墙限制这些端口只给本机和运维网段，不要对整个办公网开放。

### 11.3 在有网的机器上导出（Windows 打包机）

架构必须是 `linux/arm64`。漏掉 `--platform` 时，Docker Desktop 会存成 amd64，目标机 `docker load` 后会报 `exec format error`。

```powershell
# 基础设施镜像，名字必须和 configure-server/docker-compose.yml 里的 image 一致
docker pull --platform linux/arm64 quay.io/coreos/etcd:v3.5.21
docker pull --platform linux/arm64 postgres:16-alpine
docker pull --platform linux/arm64 redis:7-alpine
docker pull --platform linux/arm64 nginx:1.27-alpine

docker image inspect --format "{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}" `
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine nginx:1.27-alpine
# 每一行都必须是 linux/arm64

New-Item -ItemType Directory -Force -Path deploy\dist | Out-Null
docker save -o deploy\dist\infra-linux-arm64.tar `
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine
docker save -o deploy\dist\nginx-linux-arm64.tar nginx:1.27-alpine

# 应用镜像（scratch，不拉基础镜像）。产物名见终端里已打出的 tar
.\package.ps1 -Platform linux/arm64

# 探针：静态二进制，不要打成镜像
Push-Location deploy-agent
$env:CGO_ENABLED = "0"
$env:GOOS = "linux"
$env:GOARCH = "arm64"
go build -ldflags="-s -w" -o ..\deploy\dist\deploy-agent-linux-arm64 .
Pop-Location
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue

# 中台静态文件（开发机有 Node 即可，服务器不需要 Node）
Push-Location web
npm ci
npm run build
Pop-Location
```

打包机上应有这些文件：

| 文件 | 内容 |
|------|------|
| `deploy/dist/infra-linux-arm64.tar` | etcd + Postgres + Redis |
| `deploy/dist/nginx-linux-arm64.tar` | 中台用的 nginx |
| `deploy/dist/configure-server-linux-arm64.tar` | 配置中心，镜像名 `configure-server:linux-arm64` |
| `deploy/dist/shop-server-linux-arm64.tar` | 示例业务，留给中台上传，先不要在服务器上手动 `docker run` |
| `deploy/dist/deploy-agent-linux-arm64` | 探针二进制 |
| `web/dist/` | 前端构建结果 |

`package.ps1` 会把**当时仓库里的** `config.example.yaml` 和 `manifest/etcd-seed` 烤进镜像。服务器上用卷盖掉这两处，改密码和数据库不用重新打包。

### 11.4 拷到服务器

用 U 盘或内网拷贝，放到固定目录（路径可改，下文按这个写）：

```text
/opt/configure-center/
  dist/                          # 上面的 tar 和探针二进制
  configure-server/
    docker-compose.yml
    docker-compose.app.yml
    scripts/pg-init/00-init.sh
    manifest/sql/pgsql/          # 000、001、002、003
    manifest/config/config.yaml  # 由 example 复制后修改，必须是文件
    manifest/etcd-seed/          # shared/ 与 services/
    data/artifacts/              # 空目录，上传的 tar 落在这里
  web/dist/                      # npm run build 的输出
  nginx/nginx.conf
  deploy-agent/
    deploy-agent                 # 即 dist 里的二进制，改名为 deploy-agent
    manifest/config/config.yaml
```

`00-init.sh` 若从 Windows 拷来，先去掉 CR，否则 Postgres 第一次初始化会失败：

```bash
sed -i 's/\r$//' /opt/configure-center/configure-server/scripts/pg-init/00-init.sh
mkdir -p /opt/configure-center/configure-server/data/artifacts
chmod +x /opt/configure-center/deploy-agent/deploy-agent
```

### 11.5 改配置再启动

口令要三处一致：`docker-compose.yml` 的 `POSTGRES_PASSWORD`、configure-server 的 `database.default.link`、etcd seed 里 shop 用的 `database.default.link`。Postgres 只在**数据卷第一次创建**时采纳密码；卷已经存在后再改环境变量不会改掉库里的口令。

`configure-server/manifest/config/config.yaml`（从 `config.example.yaml` 复制）：

```yaml
server:
  address: ":9000"
  openapiPath: "/api.json"
  swaggerPath: "/swagger"
  clientMaxBodySize: "512MB"

logger:
  level: "all"
  stdout: true

database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/config_center"
    debug: false

svc:
  etcd:
    host: "127.0.0.1:2379"
    seedDir: "manifest/etcd-seed"

auth:
  jwtSecret: "换成足够长的随机串"
  expire: "24h"
  users:
    - username: admin
      password: "换成管理员密码"
      role: admin
  agentToken: "换成与探针相同的令牌"

deploy:
  artifactDir: "data/artifacts"
  jobTimeout: "10m"
```

仓库里的 `manifest/etcd-seed/shared/database.yaml` 若仍是达梦连接串，微服务会去连达梦。上线前改成 Postgres，并确认 Redis 端口是宿主机的 `6380`：

```yaml
# shared/database.yaml  —— shop 业务库，不是 config_center
database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/app_db"
    debug: false
```

```yaml
# shared/redis.yaml
redis:
  default:
    address: 127.0.0.1:6380
    db: 0
```

`services/shop-server.yaml` 保持服务自己的 `server.address: ":8000"` 即可。seed 只在 etcd 里还没有这个 key 时写入；第一次启动前改对，避免之后只能调强制 seed 覆盖。

探针 `deploy-agent/manifest/config/config.yaml`：

```yaml
agent:
  nodeId: "arm64-1"
  server: "http://127.0.0.1:9000"
  token: "与上面 auth.agentToken 相同"
  interval: "10s"
  dockerNetwork: ""
  loopbackAs: "host.docker.internal"
```

中台 `/opt/configure-center/nginx/nginx.conf`：

```nginx
server {
    listen 8080;
    server_name _;
    client_max_body_size 512m;
    root /usr/share/nginx/html;
    location /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`config.yaml` 和 `nginx.conf` 必须先是文件。若文件还不存在就执行 `compose up`，Docker 会按卷路径建出一个**同名目录**，进程会起不来。

### 11.6 导入镜像并拉起 etcd / Postgres / Redis

```bash
cd /opt/configure-center
docker load -i dist/infra-linux-arm64.tar
docker load -i dist/configure-server-linux-arm64.tar
docker load -i dist/nginx-linux-arm64.tar

docker image inspect --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}' \
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine \
  configure-server:linux-arm64 nginx:1.27-alpine

cd configure-server
docker compose up -d --pull never
docker compose ps
```

`--pull never` 保证这台机器不会去访问镜像仓库。三个容器都变成 healthy 再继续。初始化脚本只在 `gf_pg_data` 为空时执行：建 `config_center`（审计、节点、发布表）和 `app_db`（`002_shop_schema.sql` 里的商品表）。

```bash
docker exec gf_etcd etcdctl endpoint health --endpoints=http://127.0.0.1:2379
docker exec gf_postgres pg_isready -U postgres -d config_center
docker exec gf_postgres pg_isready -U postgres -d app_db
docker exec gf_redis redis-cli ping
```

### 11.7 拉起 configure-server

仍在 `configure-server` 目录：

```bash
docker compose -f docker-compose.app.yml up -d --pull never
docker logs -f configure-server
```

日志里应能看到 seed 写入。etcd 连不上会退出；审计库连不上只会告警，历史和发布接口之后会失败，所以这一步要等 Postgres healthy。

```bash
curl -sS http://127.0.0.1:9000/api/v1/health
docker exec gf_etcd etcdctl get /config-center/shared/database --print-value-only
```

第二条应是 `pgsql:...@tcp(127.0.0.1:5433)/app_db`，而不是达梦。Swagger：`http://<服务器IP>:9000/swagger/`。

中台页面：

```bash
docker run -d --name configure-web --restart unless-stopped --network host \
  -v /opt/configure-center/web/dist:/usr/share/nginx/html:ro \
  -v /opt/configure-center/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27-alpine
```

浏览器打开 `http://<服务器IP>:8080`，用 `config.yaml` 里的管理员账号登录。页面和 API 同源，由 nginx 把 `/api` 转到本机 `9000`。

### 11.8 安装探针（systemd）

```bash
install -m 755 /opt/configure-center/dist/deploy-agent-linux-arm64 \
  /opt/configure-center/deploy-agent/deploy-agent
```

`/etc/systemd/system/deploy-agent.service`：

```ini
[Unit]
Description=configure-center deploy agent
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=/opt/configure-center/deploy-agent
ExecStart=/opt/configure-center/deploy-agent/deploy-agent
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now deploy-agent
journalctl -u deploy-agent -f
```

工作目录必须是 `deploy-agent`，这样才会读到 `manifest/config/config.yaml`。进程以 root 跑，才能调本机 `docker`。日志里应出现 `node=arm64-1`，并且没有持续的 `docker info` 报错。中台「节点」页在约 45 秒内显示在线，平台为 `linux/arm64`。

改探针配置后执行 `systemctl restart deploy-agent`。

### 11.9 用中台发布 shop-server

不要在服务器上对 shop 再手工 `docker run`。把 `shop-server-linux-arm64.tar` **保持这个文件名**上传到发布页（文件名里的 `linux-arm64` 会被认成平台 `linux/arm64`、镜像 `shop-server:linux-arm64`）。选节点 `arm64-1`，宿主机端口 `8000`，下发。

探针随后会：下载 tar → `docker load` → 写实例配置（etcd 地址为 `host.docker.internal:2379@shop-server`）→ 拉起 `cc-shop-server`。容器内的 `127.0.0.1:5433` / `:6380` 会被改写成 `host.docker.internal`，从而连到本机 compose 发布的 Postgres 和 Redis。

```bash
curl -sS http://127.0.0.1:8000/api/v1/health
docker ps --filter name=cc-shop-server
```

### 11.10 验收与以后怎么改

| 检查 | 期望 |
|------|------|
| `docker compose ps` | `gf_etcd`、`gf_postgres`、`gf_redis` 为 healthy |
| `curl :9000/api/v1/health` | 成功，etcd 可达 |
| etcd `shared/database` | Postgres `app_db`，端口 5433 |
| `systemctl is-active deploy-agent` | `active` |
| 中台节点页 | `arm64-1` 在线，平台 `linux/arm64`，有 CPU / 内存 |
| `curl :8000/api/v1/health` | shop 已发布且 etcd 为配置来源 |

以后只改业务配置：在中台改 YAML，不必重新导 tar。换镜像：在打包机重新 `package.ps1 -Platform linux/arm64`，把新 tar 拷进内网，中台上传后再发布。改 configure-server 的 `config.yaml` 或 seed 目录后：

```bash
cd /opt/configure-center/configure-server
docker compose -f docker-compose.app.yml up -d --pull never
```

已经写进 etcd 的 key，普通重启不会覆盖。需要强制覆盖时，用管理员调用 `POST /api/v1/configs/seed`，body 为 `{"force": true}`。

不要 `docker compose down -v`，否则 Postgres 和 etcd 的数据卷会一起删掉。补表而不是重建时，可在库已存在的情况下手工执行 `manifest/sql/pgsql/003_node_metrics.sql`（`IF NOT EXISTS`，可重复）。

### 11.11 失败时先看哪里

| 现象 | 原因 |
|------|------|
| 容器 `exec format error` | tar 是 amd64。回打包机检查 `docker image inspect` 的 Architecture 后重新 `docker save` |
| `compose up` 仍去拉镜像 | 没加 `--pull never`，或 `docker load` 后的仓库名/标签和 compose 里的 `image` 不一致 |
| Postgres 一直重启，日志里有 `$'\r'` | `00-init.sh` 是 Windows 换行，按 §11.4 做 `sed` 后**删除数据卷**再 up（初始化失败的卷不会重跑脚本） |
| 配置中心退出，日志连不上 etcd | 先等 `gf_etcd` healthy；确认 app compose 是 `network_mode: host` |
| 微服务连不上数据库 | seed 仍是达梦，或端口写成了容器内的 5432/6379。宿主机侧是 5433 和 6380 |
| 节点页没有这台机器 | `agentToken` 不一致、`server` 不是 `http://127.0.0.1:9000`，或 systemd 的 `WorkingDirectory` 不是探针目录 |
| 发布被拒绝，架构不一致 | 上传的 tar 文件名不是 `*-linux-arm64.tar`，或探针上报的不是 `linux/arm64` |
| 中台能开页但接口 404 | nginx 没有把 `/api/` 代理到 `127.0.0.1:9000`，或 configure-server 没在 host 网络的 9000 上 |

