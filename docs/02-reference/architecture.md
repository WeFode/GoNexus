# 架构与实现链路

本文说明**整条链路怎么跑通**：进程先后顺序、调用了哪些依赖/API、代码文件如何互相引用。怎么用见 [快速开始](../01-getting-started/quickstart.md)，接口字段见 [HTTP API 参考](api.md)。

## 1. 运行时拓扑

```
浏览器 :5173 (Vite dev)  或  :8080 (生产 nginx)
    │  /api → 代理
    ▼
configure-server :9000          deploy-agent（各节点循环）
    │ JWT 写配置 / 建发布任务        │ X-Agent-Token
    │ 管理端 etcd Client            │ docker CLI
    ▼                                 ▼
etcd :2379  ◄──── Watch/Get ────  shop-server :8000（或容器 cc-shop-server）
    ▲                                 │
    │ Seed / CRUD                     ├─ g.DB()    → Postgres :5433 / app_db
    │                                 └─ g.Redis() → Redis :6380
Postgres :5433
    ├─ config_center   （审计 + 发布 + 账户，configure-server 用）
    └─ app_db          （shop-server 业务库）
```

关键点：**configure-server 不在热更新的数据面上**。微服务直连 etcd，配置中心挂了不影响已下发的配置读写，只影响改配置和发布。

## 2. 两条互相独立的业务链路

| 链路 | 真相源 | 作用 |
|------|--------|------|
| **配置热更新** | etcd | 中台改 YAML → etcd Put → 微服务 Watch → 内存 `g.Cfg()` 更新 |
| **镜像发布** | Postgres 任务表 + 磁盘 tar | 中台下发 job → Agent `docker load` / `run`。**不经过 etcd** |

配置变更**不需要**重新发镜像；发镜像**不会**改 etcd 里的业务配置。容器启动时 Agent 只往实例目录写本地 `svc.etcd.host`，真正的 `server` / `database` / `redis` 仍从 etcd 拉——所以容器起来后走的还是链路 A。

两条链路只在**服务名**上对齐：`svc.etcd.host` 的 `@` 后缀 = etcd `services/<名>` = 中台服务 key = `catalog.name` = 容器 `cc-<名>`。

## 3. 技术栈与依赖

### 3.1 Go 模块（`go.work`）

```
go.work
  ./pkg/etcdcfg        共用 SDK
  ./configure-server   配置中心 :9000
  ./shop-server        示例微服务 :8000
  ./deploy-agent       节点 Agent
```

| 模块 | 直接依赖 | 用途 |
|------|----------|------|
| `pkg/etcdcfg` | `gogf/gf/v2`、`go.etcd.io/etcd/client/v3` | 实现 `gcfg.Adapter`；etcd Get/Put/Watch/Txn |
| `configure-server` | `etcdcfg`、`gf/v2`、`contrib/drivers/pgsql`、`contrib/drivers/dm`、`golang-jwt/jwt/v5`、`golang.org/x/crypto`（bcrypt） | HTTP API、JWT、审计与发布编排 |
| `shop-server` | `etcdcfg`、`gf/v2`、pgsql 驱动、`contrib/nosql/redis` | 业务 API；配置全部走 Adapter |
| `deploy-agent` | `gf/v2`（只用来读本地 yaml、打日志） | 心跳、拉 tar、调 docker CLI |

Agent **不用** Docker SDK，只 `exec.Command("docker", ...)`（`deploy-agent/internal/dockerx/docker.go`）。

`pkg/etcdcfg` 静态编译进各微服务二进制，镜像里没有单独的 `pkg/` 目录。

**configure-server 不用 `etcdcfg.Boot` 替换自己的 `g.Cfg()`**。它的 HTTP 端口、JWT、Postgres DSN 仍在本地 `manifest/config/config.yaml`；它只用 `etcdcfg.NewClient` 当 **etcd 管理员客户端**。

### 3.2 前端

| 包 | 用途 |
|----|------|
| React 19 + react-router-dom 7 | 页面与路由 |
| shadcn/ui（`radix-ui` 原语）+ lucide-react | 中台 UI 与图标 |
| Tailwind CSS 4 + cva / tailwind-merge | 设计 token、变体与类名合并 |
| sonner | 轻提示 toast |
| Vite 7 + @vitejs/plugin-react | 开发与打包 |

浏览器**只**调 configure-server。Vite 把 `/api` 代理到 `http://127.0.0.1:9000`；生产由 nginx 做同样的事。前端从不直连 etcd。

### 3.3 工具链

| 工具 | 谁调用 | 做什么 |
|------|--------|--------|
| Go 1.25+ | `go run` / `package.*` | 编译 |
| Docker | compose、Agent、`package.*` | 基础设施、`docker load/run`、打 scratch 镜像 |
| etcdctl | `scripts/etcd-rbac.sh` | 生产开 auth、给微服务只读角色 |
| Node.js + npm | `web/` | Vite dev server、打包静态文件 |
| PowerShell / bash | `package.ps1` / `package.sh` | 交叉编译 + `docker save` 出 tar |
| GoFrame CLI | `hack/hack-cli.mk` | `gf gen dao/ctrl/service`、`gf pack`、`gf build` |

## 4. GoFrame 分层与文件约定

configure-server / shop-server 都按 GoFrame 官方分层：

```
api/<域>/v1/*.go          请求/响应 + g.Meta 路由（生成 OpenAPI）
internal/controller/      薄封装：校验 / 取鉴权上下文 → service
internal/service/*.go     接口定义 + RegisterXxx（IoC）
internal/logic/<域>/      真正实现；包 init() 里 Register
internal/cmd/cmd.go       启动：Boot → 绑路由 → s.Run()
internal/boot/            仅 configure-server：JWT、审计库探测、etcd client、seed
internal/middleware/      CORS、JWT
utility/                  与业务无关的包（etcdx、authx）
manifest/config/          本地引导配置（GoFrame 默认搜索路径）
```

`main.go` 的**空白 import 顺序就是隐式初始化顺序**，必须先于 `cmd.Main.Run`：

```
_ internal/packed          把 manifest/config 打进二进制（gf pack）
_ pgsql / dm / redis 驱动   注册 g.DB / g.Redis 的底层驱动
_ internal/logic           触发 logic/*/init → service.Register*
然后 cmd.Main.Run
```

**业务代码禁止在 `init()` 里连 etcd。** 微服务在 `cmd` 函数体里调 `etcdcfg.Boot`，且必须早于第一次 `g.Server()` / `g.DB()` / `g.Redis()`。理由见 [设计决策记录](../03-development/design-decisions.md)。

HTTP 统一响应由 `ghttp.MiddlewareHandlerResponse` 包成 `{code, message, data}`。前端 `web/src/api/client.ts` 按这个结构解析；`code !== 0` 或 HTTP 401 则清 token 跳登录。

## 5. 链路 A：配置热更新

### 5.1 configure-server 启动顺序

```
configure-server/main.go
  packed + pgsql/dm 驱动 + logic 空白 import
  cmd.Main.Run
    └─ internal/cmd/cmd.go
         ① boot.Init
         ② g.Server() 绑中间件与 controller
         ③ s.Run() 监听 :9000
```

`internal/boot/boot.go` 内部四步：

1. **`authx.Init`**（`utility/authx/authx.go`）读 `auth.jwtSecret` / `auth.expire`；账户优先走 `auth_users` 表（bcrypt），表不存在或为空时回退到 `auth.users` 静态配置。
2. **`pingAuditDB`** `SELECT count` 探测 `config_history` 是否可读。库表由 `manifest/sql/` 创建，**启动代码不建表**。失败只打 warning，历史/发布接口之后会报错。
3. **`etcdcfg.NewClient`**（不是 `Boot`）本地 `svc.etcd.host` 形如 `127.0.0.1:2379`，**没有** `@服务名`。底层 `clientv3.New` + `Status` ping，成功后 `etcdx.Set(client)` 放进程单例。
4. **`service.Config().Seed`** 扫 `manifest/etcd-seed/shared/*.yaml` 与 `services/*.yaml`，`PutIfAbsent` 写 etcd（已存在跳过）。每条成功写入附带一条 `config_history`。

logic 注册早于 boot（空白 import 阶段）：`internal/logic/logic.go` → `_ config` + `_ deploy`，各自 `init()` 调 `service.RegisterConfig` / `RegisterDeploy`。

路由（`internal/cmd/cmd.go:28-45`）**两组**：

- 全局 `middleware.CORS`
- `/api/v1` + `JWT`：只挂 `GET /agent/artifacts/{id}/file` → `deploy.DownloadArtifact`。**不带** `MiddlewareHandlerResponse`，返回原始 tar 文件流。
- `/api/v1` + `JWT` + `MiddlewareHandlerResponse`：`Bind(health, auth, config, deploy)`

鉴权分流见 [HTTP API 参考](api.md#鉴权矩阵)。写配置时 controller **忽略**请求体里的 `operator`，用 ctx 里的登录名（`internal/controller/config/config_v1.go` 的 `audit()`）。强制 seed 要求 `role=admin`。

### 5.2 中台改一条配置时发生什么

以编辑 `shop-server` 为例：

```
ServicesPage → ConfigListPage 点保存
  → putService()                        web/src/api/config.ts
  → fetch PUT /api/v1/configs/services/shop-server
  → 代理 → :9000
  → middleware.JWT
  → controller/config.PutService        从 ctx 取 operator/role
  → service.Config().PutService         接口
  → logic/config.PutService
       1. etcdx.Client().GetService   判断 CREATE / UPDATE
       2. ensureBaseline              首次修改前把旧值补成一条 BASELINE 历史
       3. etcdx.Client().PutService   → etcdcfg.Client.Put
            yamlToMap 校验 YAML（根节点必须是 map）
            clientv3.Put("/config-center/services/shop-server", yaml)
       4. recordHistory               g.DB().Insert config_history（MAX(version)+1）
```

etcd Put 成功后，**所有**正在 Watch 该 key 的微服务在约 150ms 防抖后拉一次合并配置。

Postgres 写历史失败**只记日志，不回滚 etcd**——etcd 是真相源，审计是附属。这是刻意的取舍，见 [设计决策记录 D-01](../03-development/design-decisions.md#d-01-运行时配置只放-etcd不做数据库双写)。

预览合并：`GET /configs/preview/{name}` → `Client.LoadMergedYAML`，与微服务启动时同一套 `deepMerge`，所见即所得。

回滚：`POST /configs/rollback` 从 `config_history` 取旧 YAML，再 etcd Put + 新插一条 `action_type=ROLLBACK`。**版本号继续递增，不是时光倒流。**

### 5.3 微服务启动与读配置

```
shop-server/main.go
  packed + pgsql + redis 驱动 + logic/product
  cmd.Main.Run
    └─ internal/cmd/cmd.go
         ① etcdcfg.Boot(ctx)          必须最先
         ② g.Server() 绑路由 + BindHealth
         ③ s.Run()  此时 server.address 已来自 etcd
```

`Boot` → `BootFromLocal`（`pkg/etcdcfg/boot.go:18`）：

1. 用**文件 Adapter**（GoFrame 默认）读本地 `svc.etcd.*`
2. `ParseHost`：`127.0.0.1:2379@shop-server` → endpoints + serviceName
3. `NewAdapter`（`adapter.go:60`）
   - `NewClient` 连 etcd
   - **失败则 `loadFromSnapshot()`** 读 `data/config-cache/shop-server.snapshot.yaml`，`source=snapshot`，后台每 5s `startReconnect`
   - 成功则 `reload()`：`LoadMerged` → `applyLoopback` → 原子写快照 → `g.Cfg().SetAdapter(adapter)`
   - `watch=true` 时 `startWatch`

`LoadMerged`（`client.go:234`）：

1. `Get` 前缀 `/config-center/shared/` 下所有 key，按名称顺序**深层合并**
2. 再 `Get` `/config-center/services/shop-server`，**覆盖**同名项
3. 结果是一张 map，同时满足 `g.Cfg().Get(ctx, "database.default.link")` 这类点号路径查询

之后第一次 `g.DB()` / `g.Redis()` / `g.Server()` 都读这张内存 map。连接池和监听端口在此时建立，**之后热更新不会重建它们**。

### 5.4 Watch 热更新（进程内）

```
startWatch
  ├─ goroutine watchLoop(shared 前缀, WithPrefix)
  ├─ goroutine watchLoop(本服务精确 key)
  └─ goroutine debounceLoop（150ms）
```

etcd 事件 → `notify` channel → 防抖合并一批 key → `reload(eventKeys)`（`adapter.go:253`）：

1. `shouldSkipReload`：若所有事件都只命中 sticky 的 **shared** 名，**跳过 etcd 拉取**（省一次全量读）
2. `LoadMerged` + loopback 改写 + 写磁盘快照
3. `applySticky`：sticky 根 key 保留内存旧值
4. 把新的不可变 `*snapshot` 原子换进 `gvar`；`g.Cfg().Get` 下次读到新值

**快照写的是未 sticky 的完整合并结果**，供下次冷启动用——sticky 只影响本次运行期内存值，不影响灾备文件。

Watch 拆成「shared 前缀 + 服务精确 key」两个 watcher，是为了生产 etcd RBAC：微服务账号不能 `Watch /config-center/` 整棵树。见 `configure-server/scripts/etcd-rbac.sh`。

`loopbackAs`：Agent 写容器内 config.yaml 时设置。把合并结果里所有 `127.0.0.1` 递归替换成 `host.docker.internal`，容器才能访问宿主机上的 etcd / Postgres / Redis。

### 5.5 `pkg/etcdcfg` 文件职责

| 文件 | 职责 |
|------|------|
| `boot.go` | `Boot` / `BootFromLocal`：读本地 host，切换 `g.Cfg()` |
| `host.go` | 解析 `ip:port[,ip:port]@服务名` |
| `keys.go` | `/config-center/shared/{name}`、`/services/{name}`，前缀规范化 |
| `client.go` | etcd CRUD、Txn `PutIfAbsent`、`LoadMerged` |
| `merge.go` | YAML↔map、`deepMerge`、`applySticky`、`applyLoopback` |
| `diff.go` | 展平、变更路径、`shouldSkipReload` 判断 |
| `snapshot.go` | 固定文件名、临时文件 rename 原子写 |
| `adapter.go` | `gcfg.Adapter` 实现：Get/Data、Watch、防抖、重连 |
| `current.go` | `Current()` / `Runtime()` |
| `probe.go` / `health.go` | 统一探活，供任意 GoFrame 服务 `BindHealth` |

etcd 协议是 gRPC（`clientv3`），不是 HTTP。SDK 细节见 [etcdcfg SDK](etcdcfg-sdk.md)。

## 6. 链路 B：中台登录与页面

```
web/src/main.tsx → App.tsx
  AuthProvider          启动时若有 token 则 GET /auth/me
  BrowserRouter
    /login              LoginPage → POST /auth/login
    RequireAuth         无 token 跳 /login
      AdminLayout
        /            OverviewPage
        /shared      SharedPage → ConfigListPage
        /services    ServicesPage → ConfigListPage + 接入指引抽屉
        /nodes       NodesPage
        /deploys     DeploysPage
```

```
POST /api/v1/auth/login
  controller/auth → authx.Login（bcrypt 校验 + HS256 签发）
  → { token, expireAt, username, role }
web：auth/session.ts 存 localStorage（键 configure-center.token）
之后 api/client.ts 的 request() 自动带 Authorization: Bearer
```

页面 ↔ 接口映射见 [中台前端](web-console.md)。

## 7. 链路 C：打包与 Agent 发布

与配置 Watch **无关**。目标：不 SSH，中台把 tar 推到节点上 `docker load` + `docker run`。

### 7.1 打包（开发机）

```
package.ps1 / package.sh
  读 deploy/catalog.json（取 name 与 containerPort）
  CGO_ENABLED=0 GOOS=linux GOARCH=<arch> go build -ldflags="-s -w"
  拷 config.example.yaml → config.yaml；拷 manifest/etcd-seed（若有）
  docker build --platform -f deploy/runtime.Dockerfile      # FROM scratch
  docker save → deploy/dist/<name>-<platform>.tar  +  同名 .json 元数据
```

`runtime.Dockerfile` 产物只有 `/app/main`、引导 `config.yaml`、`/app/manifest/etcd-seed`。

> `catalog.json` 的 `dockerfile` 字段**两个脚本都不读取**，构建固定用 `deploy/runtime.Dockerfile`。

### 7.2 上传与下发

```
DeploysPage 选 tar
  → POST /api/v1/artifacts  (multipart)
  → controller/deploy.UploadArtifact → logic/deploy.SaveArtifact
       落盘 data/artifacts/<id>-<service>.tar、算 sha256、INSERT deploy_artifacts

点发布
  → POST /api/v1/deploys { nodeIds, artifactId, hostPort, strategy, canaryCount, canaryHostPort }
  → CreateDeploy → insertNodeJob
       节点 last_seen 必须 < 45s，否则拒绝
       platformsMatch(产物平台, 节点 docker_platform) 必须成立
       INSERT deploy_jobs  status = pending | waiting
```

**灰度语义**（`logic/deploy/deploy.go:400-424`）：`canaryHostPort > 0` 时只能一台节点，插一条 `action=canary` 打旁路端口，旧容器不动；否则按 `strategy` 决定前 `canaryCount` 台 `pending`、其余 `waiting`。`Promote` 把 `waiting` 改 `pending`，或把成功的旁路 canary 变成正式 `deploy` 并下发 `stop-canary`。

### 7.3 Agent 循环（`deploy-agent/main.go`）

默认 `agent.interval=10s`，一轮：

1. `dockerx.Info`（`docker info --format` 取 NCPU / MemTotal / OSType / Architecture）
2. `ListContainers`（`docker ps -a --filter name=cc-`）+ `Stats`（`docker stats --no-stream`）填每容器 CPU/内存
3. `hostmetrics.Collect` 读 `/proc/meminfo`、`/proc/stat`、cgroup v2；`hostmetrics.Quota` 把 ncpu/内存夹到 cgroup 限额
4. `PublishedHostPorts` 取已发布宿主机端口，供端口冲突判定
5. `POST /api/v1/agent/heartbeat` + `X-Agent-Token`（`metrics` 缺省时服务端记为「未上报」，不当成 0% 占用）
6. 服务端：只把 `cc-*` 容器写入 `deploy_nodes`；该节点已有 `running` 则不派活；否则取出最多 5 条 `pending`
7. Agent 对每条 job：`report(running)` → `GET /agent/artifacts/{id}/file` → `docker load -i` → 写实例 `config.yaml`（含 `loopbackAs`）→ `docker rm -f cc-<name>` → `docker run` 挂载配置与 snapshot 目录 → `WaitHealthy` → `report(success|failed)`
8. 服务端 `reclaimStaleJobs`：`running` 超过 `deploy.jobTimeout`（默认 10m）改 `failed`

健康探测失败时 Agent 用 `run` 前记下的旧镜像**自动回滚**再探一次，任务回写 `failed`。细节见 [deploy-agent](deploy-agent.md)。

Agent 生成的容器内配置只有 etcd 入口：

```yaml
svc:
  etcd:
    host: "host.docker.internal:2379@shop-server"
    watch: true
    snapshotDir: data/config-cache
    loopbackAs: "host.docker.internal"
```

容器起来后走的仍是链路 A。

## 8. 数据落在哪

### 8.1 etcd（运行时配置，唯一真相）

前缀默认 `/config-center`（`pkg/etcdcfg/keys.go:7`），可被 `svc.etcd.prefix` 覆盖。

| Key | 内容 | 谁写 | 谁读 |
|-----|------|------|------|
| `/config-center/shared/database` | 公共 Postgres DSN 等 | configure-server / seed | 所有微服务 `LoadMerged` |
| `/config-center/shared/redis` | 公共 Redis | 同上 | 同上 |
| `/config-center/services/shop-server` | `server` / `logger` / `test` | 同上 | 仅 shop-server（及预览接口） |

**没有** `config_info` 表双写。Postgres 挂了，已写入 etcd 的配置对微服务仍然有效。

### 8.2 审计库（PostgreSQL `config_center` / 达梦 `CONFIG_CENTER`）

| 表 | 用途 |
|----|------|
| `config_history` | 每次 etcd 写成功后追加版本；回滚读这里 |
| `deploy_nodes` | Agent 心跳覆盖；`last_seen` 算在线；整机 CPU/内存/端口 |
| `deploy_artifacts` | tar 元数据 + `file_path` |
| `deploy_jobs` | `pending` / `waiting` → `running` → `success` / `failed` |
| `auth_users` | bcrypt 账户与失败锁定（缺失时回退 `auth.users`） |

字段与初始化脚本见 [数据库表结构](database-schema.md)。

shop-server 业务表在**另一个库** `app_db`（compose 的 `POSTGRES_DB`），DSN 来自 etcd `shared/database`。

### 8.3 本地磁盘

| 路径 | 谁写 | 用途 |
|------|------|------|
| `<服务>/data/config-cache/<服务>.snapshot.yaml` | Adapter 每次成功合并 | etcd 故障时冷启动 |
| `configure-server/data/artifacts/*.tar` | 上传接口 | Agent 下载 |
| `deploy-agent/data/instances/<svc>/config/config.yaml` | Agent | 挂进容器只读 |
| `deploy-agent/data/instances/<svc>/cache/` | 容器进程 | 容器内 snapshot |

## 9. 关键文件对照（按调用顺序读）

**配置中心**

```
configure-server/main.go
internal/packed                    # gf 打包本地 yaml
internal/logic/logic.go            # 空白 import 注册
internal/logic/config/config.go    # putConfig / ensureBaseline / recordHistory / seedGroup
internal/logic/deploy/deploy.go    # Heartbeat / CreateDeploy / Promote / insertNodeJob
internal/logic/deploy/recommend.go # blockReason / idleScore
internal/logic/deploy/platform.go  # normalizePlatform / platformsMatch
internal/boot/boot.go
internal/cmd/cmd.go                # 两组路由
internal/middleware/auth.go        # CORS / JWT / agent 分流
internal/controller/{auth,config,deploy,health}/
api/{auth,config,deploy,health}/v1/
utility/authx/authx.go             # bcrypt + HS256 + 失败锁定
utility/etcdx/etcdx.go             # 进程内 etcd Client 单例
manifest/config/config.yaml
manifest/etcd-seed/                # 启动 seed 源
manifest/sql/{pgsql,dm}/           # 建库建表（进程不执行）
scripts/pg-init/                   # compose 首次初始化调用
scripts/etcd-rbac.sh               # 生产 etcd 权限
```

**SDK 与示例服务**

```
pkg/etcdcfg/*                      # 见 §5.5
shop-server/internal/cmd/cmd.go    # Boot + BindHealth
shop-server/internal/controller/config/   # /config/runtime 热更新演示
shop-server/internal/controller/product/  # 业务 CRUD
shop-server/manifest/config/config.yaml   # 仅 svc.etcd.host
```

**前端**

```
web/src/main.tsx → App.tsx
web/src/api/{client,auth,config,deploy}.ts
web/src/pages/*
web/src/components/{YamlEditor,ConfigEditorModal,HistoryDrawer,RecommendPanel,ServiceOnboardDrawer}
web/src/onboard/snippets.ts        # GoFrame 接入片段
web/vite.config.ts                 # /api 代理
```

**发布**

```
deploy/catalog.json
package.ps1 / package.sh
deploy/runtime.Dockerfile
deploy-agent/main.go               # run / tick / handleJob / deployImage
deploy-agent/internal/dockerx/     # docker CLI 封装 + health.go 探测 + port.go 冲突诊断
deploy-agent/internal/hostmetrics/ # sample / parse / cgroup / memory_*
```

## 10. 设计边界（读代码时不要搞混）

1. **etcd = 运行时配置**；Postgres = 审计 + 部署编排 + 账户。不要把配置再写进 `config_info`。
2. **configure-server 不采集**各微服务 `/health` 当节点指标。节点状态**只**来自 Agent 心跳。
3. **热更新只换内存 YAML**，不重绑端口、不重建连接池。换 DSN 要发版滚动，或把 `database` 放进 `stickyKeys`。
4. **服务名四处必须相同**：`svc.etcd.host` 的 `@` 后缀、etcd `services/<名>`、`catalog.json` 的 `name`、容器 `cc-<名>`。
5. **不要把 Boot 放进 `init()`**，否则 `go test` 会连 etcd。
6. **发布页的「灰度」不是流量灰度**。它只决定新镜像先在哪台机器、哪个端口跑起来；用户无感的流量切分必须由独立 API Gateway 读 etcd 白名单/百分比来做。本仓库没有网关进程。
7. 当前**没有 gRPC 配置通道**。若未来要统一推送或强鉴权审计，可在 configure-server 上加一层，但**不是接入前提**。
8. 配置中心自己的容器**不要用 `cc-` 前缀**，否则会被 deploy-agent 当成业务容器上报。

## 相关文档

- [HTTP API 参考](api.md) · [etcdcfg SDK](etcdcfg-sdk.md) · [deploy-agent](deploy-agent.md)
- [配置项字典](configuration.md) · [数据库表结构](database-schema.md) · [中台前端](web-console.md)
- [设计决策记录](../03-development/design-decisions.md)
