# 实现逻辑与代码解读

`README.md` 说明**怎么用**。本文说明**整条链路怎么跑通**：进程先后顺序、调用了哪些工具/依赖/API、代码文件如何互相引用。

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

compose 把 `configure-server/manifest/sql/pgsql` 与 `shop-server/manifest/sql/pgsql` 交给 `scripts/pg-init`：首次建卷时创建 `config_center`（审计/发布表）和 `app_db`（shop 业务表）。**配置中心进程不再执行 DDL**。信创达梦脚本分别在两个模块的 `manifest/sql/dm/`。

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

1. `docker info` / `docker ps -a --filter name=cc-`（`dockerx`）
2. `POST /api/v1/agent/heartbeat` + `X-Agent-Token`
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
| GET | `/nodes` | 心跳表 + 在线计算 |
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
