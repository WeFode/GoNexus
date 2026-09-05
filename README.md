# configure-center

基于 **etcd + GoFrame** 的配置中心方案：各微服务本地只保留 etcd 入口，业务配置由 `configure-server` 统一写入 etcd 并支持热更新。

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
| GET | `/api/v1/configs/history/{kind}/{key}` | 发布历史（Postgres `config_center.config_history`） |
| POST | `/api/v1/configs/rollback` | 按历史版本回滚（etcd Put + 新历史记录） |
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

`.\package.ps1 -Service your-service` 生成 tar，中台上传后由各节点 Agent 部署。容器名固定为 `cc-<服务名>`。

## Docker 打包与部署

根目录一键打 tar（Windows Docker Desktop 默认 `linux/amd64`；ARM 机器用 `-Platform linux/arm64`）：

```powershell
.\package.ps1                      # shop-server + configure-server
.\package.ps1 -Service shop-server
.\package.ps1 -Platform linux/arm64
```

产物在 `deploy/dist/<服务>-linux-amd64.tar`，上传到中台「发布」页。机器上跑 `deploy-agent`（与配置中心 `auth.agentToken` 一致），中台即可下发 `docker load` + 拉起容器，不必 SSH。选一台节点发布即灰度，任务成功后再发其它节点；回滚会把该节点上一成功产物重新发布。

配置热更新仍走 etcd Watch，与镜像发布相互独立。

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
A: configure-server `:9000`，shop-server `:8000`，etcd `2379`，Postgres `5433`，Redis `6380`。
