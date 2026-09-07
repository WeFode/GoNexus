# configure-center

基于 **etcd + GoFrame** 的配置中心方案：各微服务本地只保留 etcd 入口，业务配置由 `configure-server` 统一写入 etcd 并支持热更新。

用法见本文；**实现链路、依赖、API 与文件调用顺序**见 [IMPLEMENTATION.md](./IMPLEMENTATION.md)。配置中心库表脚本见 [configure-server/manifest/sql](./configure-server/manifest/sql)（PostgreSQL / 达梦）。

## 目录结构

```
configure-center/
├── pkg/etcdcfg/          # GoFrame 微服务共用 SDK（Boot + BindHealth）
├── examples/gf-service/  # 新服务复制模板（config.yaml + cmd 片段）
├── configure-server/     # 配置中心 HTTP API + etcd seed（:9000）
├── shop-server/          # 示例微服务（:8000）
├── web/                  # 中台前端（Vite + React + antd，:5173）
├── deploy-agent/         # 节点 Agent（docker load / run）
└── go.work               # 本地多模块开发
```

## 架构

```
configure-server (:9000)
    │  PUT/GET /api/v1/configs/*
    ▼
etcd (:2379)
    │  /config-center/shared/*      公共配置（database、redis…）
    │  /config-center/services/*    各服务专属配置
    ▼
shop-server / 其他微服务
    本地 manifest/config/config.yaml 仅含 svc.etcd.host
```

合并规则：`shared/*` 深层合并后，再由 `services/<服务名>` 覆盖同名项。

## 快速开始

```powershell
# 1. 基础设施（etcd + Postgres + Redis）
cd configure-server
make docker-up

# 2. 配置中心（启动时自动 seed 缺失配置到 etcd）
make run
# Swagger: http://127.0.0.1:9000/swagger/

# 3. 微服务
cd ../shop-server
make run
# Swagger: http://127.0.0.1:8000/swagger/

# 4. 中台前端
cd ../web
npm install && npm run dev
# http://127.0.0.1:5173
# 登录：admin / admin123 或 operator / operator123
```

## 微服务本地配置

`shop-server/manifest/config/config.yaml` 示例：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@shop-server"   # ip:port@服务名
    watch: true
    snapshotDir: "data/config-cache"     # 合并后 YAML 快照，etcd 不可用时回退
    # stickyKeys:
    #   - database
    #   - redis
    #   - server
```

| 字段 | 说明 |
|------|------|
| `host` | `ip:port@服务名`；服务名对应 etcd `/config-center/services/<名>` |
| `watch` | `true`（默认）监听 etcd 并热更新内存快照，不重启进程 |
| `snapshotDir` | 合并 YAML 落盘目录；无快照且 etcd 不可用则启动失败 |
| `skipSharedWatch` | `true` 时不接收公共配置变更 |
| `stickyKeys` | **不参与热重载**的根 key；**不配置则全部为 live 热重载** |

## 热重载（stickyKeys）

| 场景 | 行为 |
|------|------|
| 未配置 `stickyKeys` | `test`、`database`、`logger` 等**全部**热重载；下次 `g.Cfg().Get()` 读到新值 |
| 配置了 `stickyKeys: [database, redis, server]` | 这些根 key **保持启动时的值**，etcd 变更不会写入内存快照 |
| 长连接 | 热重载**只改内存**，不会重建 DB/Redis 连接池、不会改 HTTP 监听端口 |
| 性能 | 仅 sticky 的 shared 配置变更时**跳过 etcd 拉取**；150ms 防抖合并多次 watch |

验证接口（shop-server）：

```bash
curl http://127.0.0.1:8000/api/v1/config/runtime
```

修改 `test.shopName` 后无需重启，再次请求即可看到新值。

## 配置中心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT/DELETE | `/api/v1/configs/shared/{key}` | 公共配置 |
| GET/PUT/DELETE | `/api/v1/configs/services/{name}` | 服务配置 |
| GET | `/api/v1/configs/preview/{name}` | 预览合并后 YAML |
| GET | `/api/v1/configs/history/{kind}/{key}` | 发布历史（`config_history`，脚本在 `configure-server/manifest/sql`） |
| POST | `/api/v1/configs/rollback` | 按历史版本回滚（etcd Put + 新历史记录）。保存时会先补录旧快照 |
| POST | `/api/v1/configs/seed` | 重新灌入 `manifest/etcd-seed` |

etcd 仍是配置真相源；Postgres 只存审计/回滚，不双写运行时配置。写操作的 `operator` 取自 JWT 登录用户，前端不能伪造。

未登录不能调用配置 API（`GET /api/v1/health` 与 `POST /api/v1/auth/login` 除外）。本地默认账户见 `manifest/config/config.example.yaml` 的 `auth.users`，生产务必改 `jwtSecret` 和密码。`operator` 不能强制覆盖 seed。

生产启用 etcd RBAC 示例见 `configure-server/scripts/etcd-rbac.sh`（先拆 Watch 为 shared 前缀 + 服务精确 key）。开发环境 compose **默认不开启** etcd auth。

## 新微服务接入

任意 GoFrame HTTP 服务接入配置中心只需 **依赖 `pkg/etcdcfg` + 本地一行 host + cmd 里 Boot**。业务代码继续 `g.Cfg().Get`，不必改。可复制模板：`examples/gf-service/`。

服务名必须全局一致：`svc.etcd.host` 的 `@` 后缀 = 中台服务 key = `catalog.name` = 容器 `cc-<名>`。

### 1. 本地配置与依赖

`manifest/config/config.yaml` 只留 etcd 入口：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@your-service"
    watch: true
    snapshotDir: "data/config-cache"
```

```
require configure-center/pkg/etcdcfg v0.0.0
replace configure-center/pkg/etcdcfg => ../pkg/etcdcfg
```

独立仓库把 replace 指到本仓库 `pkg/etcdcfg`。

### 2. 在 cmd 里 Boot（不要用 init）

必须在 `g.Server()` / `g.DB()` 之前。不要放 `init()` 或 `main.go` 空白 import，否则 `go test` 会强行连 etcd。

```go
if err = etcdcfg.Boot(ctx); err != nil {
    return err
}
s := g.Server()
s.Group("/api/v1", func(group *ghttp.RouterGroup) {
    group.Middleware(ghttp.MiddlewareHandlerResponse)
    etcdcfg.BindHealth(group) // GET /api/v1/health，configFrom=etcd|snapshot
    group.Bind(/* 业务 controller */)
})
```

参考：`shop-server/internal/cmd/cmd.go`。

### 3. 在配置中心登记服务

中台「服务配置」新建（与 `@` 后同名），或把 YAML 放到 `configure-server/manifest/etcd-seed/services/<服务名>.yaml`。公共项放 `shared/`，服务覆盖同名 key。

### 4. 纳入一键打包（可选，用于中台发布）

编辑根目录 `deploy/catalog.json`：

```json
{ "name": "your-service", "dockerfile": "your-service/Dockerfile", "containerPort": 8080 }
```

`.\package.ps1 -Service your-service` 生成 tar，中台上传后由各节点 Agent 部署。容器名固定为 `cc-<服务名>`（旁路灰度为 `cc-<服务名>-canary`）。

## Docker 打包与部署

根目录一键打 tar（Windows Docker Desktop 默认 `linux/amd64`；ARM 机器用 `-Platform linux/arm64`）：

```powershell
.\package.ps1                      # shop-server + configure-server
.\package.ps1 -Service shop-server
.\package.ps1 -Platform linux/arm64
```

产物在 `deploy/dist/<服务>-linux-amd64.tar`，上传到中台「发布」页。机器上跑 `deploy-agent`（与配置中心 `auth.agentToken` 一致），中台即可下发 `docker load` + 拉起容器，不必 SSH。

**发布策略（只负责把镜像跑起来，不切用户流量）**

配置中心的「灰度 / 全量」是**发布编排**：新 tar 先出现在哪些机器、哪个端口。用户请求仍打到原来的地址，直到网关把流量切过去。

| 策略 | 行为 |
|------|------|
| **灰度（多节点）** | 先给前 N 台下发 `pending`，其余 `waiting`。金丝雀验证通过后点「推进其余节点」。 |
| **灰度（单节点）** | 只发这一台。若填写**灰度端口**，旧容器不中断，新版本以 `cc-<服务>-canary` 旁路运行；确认后再「转正」。 |
| **全量** | 选中节点同时替换主容器。 |

**流量灰度（用户无感）要由 API Gateway 做**，不是发布页。正确闭环：

1. 旧实例继续在主端口提供服务（用户仍走网关 → 旧实例）。
2. 发布页用旁路端口拉起新 tar（`cc-<服务>-canary`），此时**没有用户会打到它**。
3. 在配置中心写网关路由（白名单 user/IP/Header，或百分比），网关 Watch etcd 后只把命中名单的请求转到 canary。
4. 验证通过：把网关切到 100% 新版本，再在发布页「转正」替换主容器、下线 canary。失败则关掉白名单，旧实例一直在。

本仓库目前没有网关进程；`shop-server` 不会自己按白名单把流量分给另一份自己。白名单配置给 **gateway-server**（统一入口）读，不要写在业务服务里。

节点页可对已发布容器 **启动 / 停止 / 重启**（Agent 调 `docker start/stop/restart`）。心跳会带上容器 CPU/内存（`docker stats`），便于看是否还活着；QPS/延迟仍应走 Prometheus，不必做进配置中心。

回滚会把该节点上一成功产物重新发布。配置热更新仍走 etcd Watch，与镜像发布相互独立。

**配置回滚**：每次保存会把 etcd 里**修改前**的 YAML 补进 `config_history`（若最新历史还不是这份旧内容），再追加新版本。历史里点旧版本回滚；当前这份不能回滚（它已是线上内容）。

Agent：

```powershell
cd deploy-agent
go run .
# 默认 nodeId=win-local ，连 http://127.0.0.1:9000
```

容器内通过 `host.docker.internal` 访问本机 etcd/Postgres/Redis（`svc.etcd.loopbackAs`）。本机 `go run` 的 shop-server 若占用 8000，发布时改宿主机端口。

### pkg 会打进镜像吗？

**会。** `go build` 将 `pkg/etcdcfg` **静态编译进单个 `main` 二进制**，运行时镜像里只有 `/app/main`，**不需要**单独挂载 `pkg/` 目录。

构建（在仓库根目录）：

```bash
docker build -t configure-server:latest -f configure-server/Dockerfile .
docker build -t shop-server:latest -f shop-server/Dockerfile .
```

导出 tar 部署：

```bash
cd configure-server && make package   # → deploy/dist/configure-server-image.tar
cd shop-server && make package
# 服务器: docker load -i xxx.tar && docker compose up -d
```

镜像内仅包含：

- 编译后的 `main` 二进制（已含 etcdcfg）
- `manifest/config/config.yaml`（仅 etcd 入口）
- configure-server 额外含 `manifest/etcd-seed`

Docker 运行 shop-server 时建议挂载 `/app/data/config-cache`，以便 etcd 故障时用上次合并 YAML 启动。

## 是否需要 gRPC？

**当前阶段不需要。**

| 方式 | 适用场景 |
|------|----------|
| **etcd 直读 + watch**（现方案） | 配置下发、热更新；各服务独立拉取，无单点 |
| gRPC 配置服务 | 需要强鉴权审计、复杂推送策略、或客户端无法直连 etcd 时 |

微服务间业务通信与配置中心无关；配置走 etcd，业务 API 继续用 HTTP 即可。若未来需要统一推送或离线缓存，可在 `configure-server` 上加 gRPC 层，但 **不是接入的前提**。

## etcd Key 约定

| Key | 示例 |
|-----|------|
| `/config-center/shared/database` | 公共数据库配置 |
| `/config-center/shared/redis` | 公共 Redis |
| `/config-center/services/shop-server` | shop-server 专属配置 |

Seed 目录：`configure-server/manifest/etcd-seed/shared/`、`services/`。

## 常见问题

**Q: 改了 database 连接串，为何 DB 仍连旧库？**  
A: 连接池在启动时建立，热重载只更新 `g.Cfg()` 内存。换 DSN 需滚动重启，或将 `database` 加入 `stickyKeys` 避免误热更。

**Q: seed 写了 0 个配置？**  
A: etcd 中已存在同名 key，seed 默认不覆盖。用 `POST /api/v1/configs/seed` 且 `"force": true` 强制覆盖。

**Q: 本地开发端口**  
A: configure-server `:9000`，shop-server `:8000`，etcd `2379`，Postgres `5433`，Redis `6380`。本机 `go run` 的 shop-server 会占 8000，此时不要对 `cc-shop-server` 点启动（Docker 也会抢 8000）。要么停掉 `go run`，要么发布时换宿主机端口。

**Q: 发布页灰度是不是网关白名单灰度？**  
A: 不是。发布页只把新镜像跑起来；用户无感的流量切分要由 API Gateway 读配置中心（etcd）的白名单/百分比，把命中请求转到 canary 端口。业务服务本身不做这层路由。

**Q: 启动日志写审计库未就绪？**  
A: 库表已从 Go 代码挪到 `configure-server/manifest/sql`。本地 compose **只在空数据卷**时自动建 `config_center`。已有卷请手工执行 `pgsql/001_schema.sql`。达梦执行 `sql/dm/` 后把 `database.default.link` 改成 `dm:CONFIG_CENTER:...@tcp(ip:5236)` 即可，不必改代码。

**Q: GoLand 编译 configure-server 报 `error obtaining VCS status: exit status 128`？**  
A: `go build` 默认要打 Git 版本戳；GoLand 若用 Administrator 打开、仓库在别的用户目录下，Git 会返回 128。仓库已加 `-buildvcs=false`。在 GoLand：**Settings → Go → Build Tags / Vendoring** 或运行配置的 **Go tool arguments** 填 `-buildvcs=false`，环境变量 `GOFLAGS=-buildvcs=false`。也可选共享运行配置 `configure-server` / `shop-server`。
