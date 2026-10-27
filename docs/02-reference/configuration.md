# 配置项字典

配置分两类：**本地引导配置**（每个模块的 `manifest/config/config.yaml`）和 **etcd 下发配置**（`shared/*` + `services/*`）。

## `config.yaml` 不进仓库

`configure-server` / `shop-server` / `deploy-agent` 的 `.gitignore` 都排除了 `manifest/config/config.yaml`，**只有 `config.example.yaml` 会被提交**。这是刻意的：本地配置里有 `jwtSecret`、账户口令、`agentToken`、本机数据库 DSN。

```bash
cp manifest/config/config.example.yaml manifest/config/config.yaml
```

打包脚本（`package.ps1` / `package.sh`）拷进镜像的也是 `config.example.yaml`（重命名为 `config.yaml`），所以**镜像里的引导配置永远是 example 那份**；服务器上用卷挂载覆盖它，改口令不必重新打包。

> 反过来说：往 `config.example.yaml` 里写真实口令会被打进镜像并提交。它只能是占位值。

## configure-server

本地 `manifest/config/config.yaml`。**这份配置不会被 etcd 替换**——配置中心是管理端，不消费自己的下发结果。

### `server`

| 键 | 默认 | 说明 |
|----|------|------|
| `server.address` | `:9000` | HTTP 监听 |
| `server.openapiPath` | `/api.json` | OpenAPI schema |
| `server.swaggerPath` | `/swagger` | Swagger UI |
| `server.clientMaxBodySize` | `512MB` | **决定能上传多大的 tar**；调小会导致发布页上传失败 |

### `database`

审计库，只放配置中心自己的库（`config_center` 或达梦 `CONFIG_CENTER`），**不是**业务库。

```yaml
database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/config_center"
    debug: false
```

达梦（信创）：

```yaml
database:
  default:
    link: "dm:CONFIG_CENTER:ConfigCenter_123@tcp(127.0.0.1:5236)"
```

`main.go` 同时注册了 pgsql 与 dm 驱动，**切换只改这一行，不用改代码**。表名列名两边对齐（达梦用双引号小写），GoFrame ORM 通用。

进程启动只 `SELECT count` 探测 `config_history` 是否可读，**不会建表**。库表脚本在 `manifest/sql/`，见 [数据库表结构](database-schema.md)。

### `svc.etcd`

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379"        # 不带 @服务名
    seedDir: "manifest/etcd-seed"
```

| 键 | 说明 |
|----|------|
| `host` | 管理端 etcd 地址。配置中心**不写** `@服务名`，它不是消费者 |
| `seedDir` | 启动时扫描并 `PutIfAbsent` 写入 etcd 的目录 |

配置中心用 `etcdcfg.NewClient` 建管理员客户端，**不用** `etcdcfg.Boot`。

### `auth`

```yaml
auth:
  jwtSecret: "configure-center-dev-secret-change-me"
  expire: "24h"
  users:
    - username: admin
      password: admin123
      role: admin
    - username: operator
      password: operator123
      role: operator
  agentToken: "dev-agent-token"
```

| 键 | 说明 |
|----|------|
| `jwtSecret` | HS256 签名密钥。**生产必须换成足够长的随机串** |
| `expire` | token 有效期 |
| `users` | 静态账户，**仅在 `auth_users` 表不存在或为空时生效**；表存在时登录走表里的 bcrypt 哈希 |
| `agentToken` | 与 deploy-agent 的 `agent.token` 必须完全一致，否则节点页看不到机器 |

登录失败 5 次锁 10 分钟，计数在内存里，重启进程会清零。

### `deploy`

| 键 | 默认 | 说明 |
|----|------|------|
| `deploy.artifactDir` | `data/artifacts` | tar 落盘目录；容器部署时挂卷 |
| `deploy.jobTimeout` | `10m` | `running` 任务超时阈值，超时后下次心跳置 `failed` |

## pkg/etcdcfg（所有业务微服务）

业务服务的本地 `config.yaml` **只应该有这一段**。其余全部来自 etcd。

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@shop-server"
    watch: true
    snapshotDir: "data/config-cache"
```

| 键 | 默认 | 说明 |
|----|------|------|
| `svc.etcd.host` | 必填 | `ip:port[,ip:port]@服务名`。`@` 后缀 = etcd `services/<名>` = 中台服务 key = `catalog.name` = 容器 `cc-<名>` |
| `svc.etcd.username` / `password` | 空 | etcd 开 RBAC 后的只读账号 |
| `svc.etcd.prefix` | `/config-center` | key 根路径 |
| `svc.etcd.watch` | `true` | 监听并热更新内存快照。**关掉不等于冻结**——`Get` 会改成每次实时读 etcd |
| `svc.etcd.skipSharedWatch` | `false` | `true` 时不接收公共配置变更，只跟本服务 key |
| `svc.etcd.stickyKeys` | 空 | **不参与热重载**的根 key。**不配置则全部热重载** |
| `svc.etcd.snapshotDir` | `data/config-cache` | 合并 YAML 落盘目录。etcd 不可用且有快照时用它启动；**两者都没有则启动失败** |
| `svc.etcd.loopbackAs` | 空 | 把合并配置里所有 `127.0.0.1` 替换成该主机名。容器内访问宿主机时由 Agent 写入 `host.docker.internal` |

`stickyKeys` 的判断只看**根 key**：填 `database` 会冻结整个 `database` 段。典型值：

```yaml
stickyKeys:
  - database    # 连接池启动时建好，热改不生效，冻结更诚实
  - redis
  - server      # 监听端口不能重绑
```

字段级行为见 [etcdcfg SDK](etcdcfg-sdk.md)。

## deploy-agent

**没有** `server` / `database` —— 探针不监听端口，也不连数据库，只按 `interval` 主动访问配置中心。

```yaml
agent:
  nodeId: "node-1"
  server: "http://127.0.0.1:9000"
  token: "dev-agent-token"
  interval: "10s"
  dockerNetwork: ""
  loopbackAs: "host.docker.internal"
  healthTimeout: "90s"
  healthInterval: "2s"
  healthPath: "/api/v1/health"
```

| 键 | 默认 | 说明 |
|----|------|------|
| `agent.nodeId` | `node-1` | 节点唯一标识，`deploy_nodes` 主键。多台机器必须不同 |
| `agent.server` | `http://127.0.0.1:9000` | 配置中心地址 |
| `agent.token` | — | 对应 `auth.agentToken`，走请求头 `X-Agent-Token` |
| `agent.interval` | `10s` | 心跳周期。在线判定是 `4 × interval ≈ 45s`，改大这个值会拉长离线判定 |
| `agent.dockerNetwork` | 空 | 非空时 `docker run` 加 `--network <名>` |
| `agent.loopbackAs` | `host.docker.internal` | 写进容器配置，并加 `--add-host host.docker.internal:host-gateway` |
| `agent.healthTimeout` | `90s` | 发布后健康探测总时长；超时则自动回滚旧镜像 |
| `agent.healthInterval` | `2s` | 探测轮询间隔 |
| `agent.healthPath` | `/api/v1/health` | 探测路径。先 TCP 后 HTTP，状态码 <500 算健康 |

`logger` 段可选，探针用 GoFrame 只读本地 yaml 和打日志。

## etcd 里的下发配置

`configure-server/manifest/etcd-seed/` 是**版本化的 seed 源**，启动时写入 etcd（不覆盖已有 key）：

```
manifest/etcd-seed/
  shared/database.yaml      → /config-center/shared/database
  shared/redis.yaml         → /config-center/shared/redis
  services/shop-server.yaml → /config-center/services/shop-server
```

### `shared/database.yaml`

给**业务服务**用的库，不是配置中心的审计库。

```yaml
database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/app_db"
    debug: false
```

> 仓库当前这份 seed 是**达梦**连接串（`dm:CONFIG_CENTER:...`）。给 Postgres 环境上线前一定要改，否则微服务会去连达梦——这是离线部署最常见的一个坑，见 [内网 ARM64 离线部署](../01-getting-started/deploy-offline-arm64.md) §5。

### `shared/redis.yaml`

```yaml
redis:
  default:
    address: 127.0.0.1:6380
    db: 0
```

端口是**宿主机侧**的 6380，不是容器内的 6379。

### `services/shop-server.yaml`

```yaml
server:
  address:     ":8000"
  openapiPath: "/api.json"
  swaggerPath: "/swagger"

logger:
  level: "all"
  stdout: true

test:
  shopName: "apple"       # 热更新演示用，controller 每次请求即时读
```

## 合并规则速记

```
最终配置 = deepMerge(shared/* 按名称顺序)  ←  被 services/<名> 覆盖
```

- **深层合并**：同名 key 两边都是 map 时递归下钻，否则整体替换。
- 服务配置覆盖某一段时要**把那段写全**——只写 `database.default.link` 会丢掉公共 `database.default` 里的其它字段。
- `GET /api/v1/configs/preview/{name}` 用与服务启动时**同一套**合并代码，改配置前先看预览。

## 口令一致性清单

Postgres 环境下这三处必须一致，且 Postgres **只在数据卷第一次创建时**采纳 `POSTGRES_PASSWORD`：

1. `configure-server/docker-compose.yml` → `POSTGRES_PASSWORD`
2. `configure-server/manifest/config/config.yaml` → `database.default.link`（`config_center`）
3. etcd `shared/database` → `database.default.link`（`app_db`）

卷已存在后改环境变量不会改掉库里的口令，只能删卷重建或手工 `ALTER USER`——**不要 `docker compose down -v`**，那会把 etcd 数据一起删掉。

## 相关文档

- [etcdcfg SDK](etcdcfg-sdk.md) —— `svc.etcd.*` 的行为细节
- [数据库表结构](database-schema.md) —— `database.link` 指向哪些表
- [deploy-agent](deploy-agent.md) —— `agent.*` 与 docker 行为
- [内网 ARM64 离线部署](../01-getting-started/deploy-offline-arm64.md) —— 生产改哪些值
