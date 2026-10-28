# 快速开始

单机跑通「配置中心 → etcd → 微服务热更新 → 中台页面」全链路。

- 目标机不能访问镜像仓库：看 [内网 ARM64 离线部署](deploy-offline-arm64.md)
- 已有服务要接进来：看 [接入新微服务](integrate-a-service.md)
- 报错：看 [常见问题](troubleshooting.md)

## 前置要求

| 工具 | 要求 | 用来做 |
|------|------|--------|
| Go | 1.25+ | 编译四个模块 |
| Docker | 带 compose v2 插件（`docker compose version` 可用） | 跑 etcd / Postgres / Redis |
| Node.js | Vite 7 要求的较新 LTS | 中台前端 |
| make | 任意 | `make run` / `make docker-up` |
| PowerShell 或 bash | 任意 | 打包脚本 `package.ps1` / `package.sh` |

四个 Go 模块由根目录 `go.work` 组成一个工作区，在仓库根之外不需要额外 `replace`。

## 1. 起基础设施

```bash
cd configure-server
make docker-up          # 等价于 docker compose up -d
```

拉起三个容器：

| 容器 | 镜像 | 宿主机端口 | 用途 |
|------|------|------------|------|
| `gf_etcd` | `quay.io/coreos/etcd:v3.5.21` | 2379 / 2380 | 配置真相源 |
| `gf_postgres` | `postgres:16-alpine` | 5433 → 5432 | 审计库 `config_center` + 业务库 `app_db` |
| `gf_redis` | `redis:7-alpine` | 6380 → 6379 | shop-server 缓存 |

等三个容器都 `healthy` 再继续：

```bash
docker compose ps
```

**Postgres 只会在数据卷第一次创建时**执行 `scripts/pg-init/00-init.sh` 建库建表。卷已经存在过（哪怕初始化失败），脚本不会再跑，需要手工补表——见 [数据库表结构](../02-reference/database-schema.md)。

## 2. 起配置中心

```bash
make run                # go run . ，监听 :9000
```

启动时按顺序做四件事：初始化 JWT → 探测审计库 → 连 etcd → 把 `manifest/etcd-seed/` 里缺失的 key 写入 etcd（`PutIfAbsent`，已存在不覆盖）。

日志里应看到 seed 写入条数。Swagger 在 <http://127.0.0.1:9000/swagger/>。

> **第一次跑必看的坑**：`manifest/etcd-seed/shared/database.yaml` 默认是本地 Postgres（`pgsql:postgres:123456@tcp(127.0.0.1:5433)/app_db`）。seed 使用 `PutIfAbsent`，如果 etcd 是旧数据卷，里面的 `database` 可能还是达梦连接串——在「公共配置」页把 `database` 保存一次，或在概览页点「强制覆盖」。改用它库时，seed 与 `database.default.link` 要一起改，见 [配置文件参考](../02-reference/configuration.md)。

验证：

```bash
curl -sS http://127.0.0.1:9000/api/v1/health
# {"code":0,"message":"...","data":{"status":"ok","etcd":"ok"}}
```

`GET /api/v1/health` 是唯一不需要登录的接口。

## 3. 起示例微服务

```bash
cd ../shop-server
make run                # :8000
```

`shop-server/manifest/config/config.yaml` 里**只有 etcd 入口**，`server` / `database` / `redis` 全部来自 etcd 合并结果：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@shop-server"   # ip:port@服务名
    watch: true
    snapshotDir: "data/config-cache"
```

验证配置来源：

```bash
curl -sS http://127.0.0.1:8000/api/v1/health
# data.configFrom = "etcd" 即接入成功；"snapshot" 表示 etcd 没连上、用了磁盘快照
```

## 4. 验证热更新

```bash
curl -sS http://127.0.0.1:8000/api/v1/config/runtime
```

在配置中心改 `services/shop-server` 里的 `test.shopName`（中台页面、Swagger、或直接 `PUT /api/v1/configs/services/shop-server` 都行），**不重启 shop-server**，再请求一次上面的地址：

- `shopName` 变成新值；
- `reloadedAt` 更新，`changed` 列出变化的路径。

机制：etcd Watch 事件 → 150ms 防抖合并 → 重新拉取合并 YAML → 只替换内存快照。详见 [etcdcfg SDK](../02-reference/etcdcfg-sdk.md)。

> 热更新只改内存。数据库连接池和 HTTP 监听端口在启动时就建好了，改 DSN 或改 `server.address` 不会生效，需要滚动重启；也可以把 `database` 放进 `stickyKeys`，让它明确不参与热重载。

## 5. 起中台前端

```bash
cd ../web
npm install
npm run dev             # :5173，/api 代理到 :9000
```

打开 <http://127.0.0.1:5173>。本地默认账户在 `configure-server/manifest/config/config.yaml` 的 `auth.users`：

| 账户 | 口令 | 角色 |
|------|------|------|
| `admin` | `admin123` | `admin`（可强制 seed） |
| `operator` | `operator123` | `operator` |

页面：概览 / 公共配置 / 服务配置 / 节点 / 发布。前端只调 configure-server，从不直连 etcd。

登录后先看到概览页，四个指标卡分别对应 etcd、配置规模与在线节点：

![概览页（截图为 mock 数据，服务名与节点均为虚构）](../assets/screenshots/overview.png)

各页面的完整说明与其它截图见 [中台前端 · 界面一览](../02-reference/web-console.md#界面一览)。

## 6. 起节点探针（可选，只有要发布镜像时才需要）

```bash
cd ../deploy-agent
cp manifest/config/config.example.yaml manifest/config/config.yaml
go run .                # 默认 nodeId=win-local，连 http://127.0.0.1:9000
```

探针不监听端口，按 `agent.interval`（默认 10s）主动心跳并领任务。`agent.token` 必须与配置中心 `auth.agentToken` 一致，否则节点页看不到这台机器。

打包出 tar：

```powershell
# 仓库根目录
.\package.ps1                              # shop-server + configure-server
.\package.ps1 -Service shop-server
.\package.ps1 -Platform linux/arm64
```

产物在 `deploy/dist/<服务>-linux-amd64.tar`，上传到中台「发布」页。完整流程见 [打包与发布](release-and-rollout.md)。

## 端口一览

| 进程 | 地址 |
|------|------|
| configure-server | `:9000` |
| shop-server | `:8000` |
| 中台前端（dev） | `:5173` |
| etcd | `2379` / `2380` |
| Postgres | `5433`（容器内 5432） |
| Redis | `6380`（容器内 6379） |
| 达梦 DM8（信创，可选） | `5236` |

本机 `go run` 的 shop-server 会占住 8000。这时不要在中台对 `cc-shop-server` 点启动——Docker 拉起的容器同样要抢 8000。要么停掉 `go run`，要么发布时换一个宿主机端口。

## 上线前必须改

1. `auth.jwtSecret`：换成足够长的随机串，别用 `configure-center-dev-secret-change-me`。
2. `auth.users` 的口令，或直接建 `auth_users` 表走 bcrypt。
3. `auth.agentToken` / `deploy-agent` 的 `agent.token`：两端一起换。
4. 开发 compose 默认**不开** etcd 认证。生产开 RBAC 见 [配置项字典](../02-reference/configuration.md) 和 `configure-server/scripts/etcd-rbac.sh`。

## 不需要的东西

- **不需要 gRPC**。配置走 etcd 直读 + Watch，各服务独立拉取、没有单点；configure-server 不在热更新的数据面上。业务 API 继续用 HTTP。
- **不需要把配置双写进 Postgres**。etcd 是唯一运行时真相源，`config_history` 只服务审计与回滚。配置中心进程不执行 DDL。
