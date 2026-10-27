# HTTP API 参考

configure-server 的全部端点，以及微服务侧由 SDK 提供的探活接口。

机器可读的 OpenAPI 文档在运行时生成，无需登录即可取 schema（`openapiPath` 本身不经过 JWT 路由）：

| 环境 | OpenAPI | Swagger UI |
|------|---------|------------|
| configure-server | `http://127.0.0.1:9000/api.json` | `http://127.0.0.1:9000/swagger/` |
| shop-server | `http://127.0.0.1:8000/api.json` | `http://127.0.0.1:8000/swagger/` |

## 通用约定

- **统一前缀** `/api/v1`。
- **响应包** 除 Agent 产物下载外，全部由 `ghttp.MiddlewareHandlerResponse` 包成：

```json
{ "code": 0, "message": "OK", "data": { } }
```

`code != 0` 表示业务失败，`message` 是中文错误原文。前端 `web/src/api/client.ts` 在 `code !== 0` 或 HTTP 401 时清 token 跳登录。

- **Agent 产物下载** `GET /api/v1/agent/artifacts/{id}/file` 注册在**单独一组**路由，不带响应包装，返回原始 tar 文件流。
- **YAML 校验** 写配置时服务端把 content 解析成 map，**根节点必须是 map**，否则报 `YAML 根节点必须是 map`。
- **操作人** 写接口的 `operator` 字段会被 controller 忽略，一律取 JWT 登录名；未登录兜底 `anonymous`。这是刻意的，防止伪造审计。

## 鉴权矩阵

| 路径 | 凭据 | 说明 |
|------|------|------|
| `POST /api/v1/auth/login` | 无 | 公开 |
| `GET /api/v1/health` | 无 | 公开（配置中心自己的探活，不是 SDK 那个） |
| `/api/v1/agent/*` | 头 `X-Agent-Token` 或 `Authorization: Bearer` | 必须等于配置中心 `auth.agentToken`，ctx 角色记为 `agent` |
| 其余全部 | `Authorization: Bearer <JWT>` | HS256，用户名与角色写入 ctx |
| `POST /api/v1/configs/seed` + `force: true` | JWT 且 `role=admin` | 否则 `仅管理员可强制覆盖 seed` |

`OPTIONS` 预检请求直接放行（`middleware.CORS`）。JWT 由 `utility/authx` 签发，`auth.expire` 默认 `24h`。

## Auth

### `POST /api/v1/auth/login`

| 字段 | 类型 | 约束 |
|------|------|------|
| `username` | string | 必填 |
| `password` | string | 必填 |

响应：

| 字段 | 说明 |
|------|------|
| `token` | HS256 JWT |
| `expireAt` | 过期时间 |
| `username` | 登录名 |
| `role` | `admin` \| `operator` |

账户优先查 `auth_users` 表（bcrypt，连续失败 5 次锁 10 分钟）；表不存在或为空时回退到本地 `auth.users` 静态账户。

### `GET /api/v1/auth/me`

响应 `{ username, role }`，取自 JWT claims。前端启动时用它校验 token 是否还有效。

## System

### `GET /api/v1/health`

配置中心自身探活，**无需登录**。

| 字段 | 说明 |
|------|------|
| `status` | `ok` \| `degraded` |
| `etcd` | etcd 连接状态（`etcdx.Client().Ping`） |

注意这与微服务侧 `etcdcfg.BindHealth` 提供的 `/health` 是**两套不同实现**：配置中心这个只报 etcd，微服务那个还报 `configFrom`、`database`、`redis`。

## Config

配置读写全部落在 etcd，历史与回滚落在审计库。`kind` ∈ `shared` | `services`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/configs/shared` | 公共配置列表 |
| GET | `/configs/shared/{key}` | 读一条，`key` 如 `database`、`redis` |
| PUT | `/configs/shared/{key}` | 写入（CREATE 或 UPDATE） |
| DELETE | `/configs/shared/{key}` | 删除 |
| GET | `/configs/services` | 服务配置列表 |
| GET | `/configs/services/{name}` | 读一个服务，`name` 如 `shop-server` |
| PUT | `/configs/services/{name}` | 写入 |
| DELETE | `/configs/services/{name}` | 删除 |
| GET | `/configs/preview/{name}` | 预览 `shared` + 服务配置合并后的完整 YAML |
| POST | `/configs/seed` | 把本地 seed 目录写入 etcd |
| GET | `/configs/history/{kind}/{key}` | 变更历史 |
| POST | `/configs/rollback` | 回滚到历史版本 |

### 列表项结构 `ConfigItem`

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 短名，如 `database` |
| `fullKey` | string | etcd 全路径，如 `/config-center/shared/database` |
| `content` | string | YAML 文本 |
| `revision` | int64 | etcd 修订号 |

### `PUT /configs/{shared|services}/{key}`

| 字段 | 类型 | 约束 |
|------|------|------|
| `content` | string | 必填，YAML |
| `remark` | string | 变更说明，进历史记录 |
| ~~`operator`~~ | string | 会被忽略，取登录名 |

副作用：写 etcd 前，若是首次修改会把**修改前**的值补成一条 `BASELINE` 历史；写成功后追加 `CREATE` / `UPDATE` 记录。etcd 是真相源——审计写失败只记日志，**不回滚 etcd**。

### `POST /configs/seed`

| 字段 | 类型 | 说明 |
|------|------|------|
| `force` | bool | `false`（默认）只写缺失项（`PutIfAbsent`）；`true` 覆盖已有 key，**要求 `role=admin`** |
| `dir` | string | 默认 `manifest/etcd-seed` |
| `remark` | string | 进历史 |

响应 `{ "written": 3 }`。返回 0 通常意味着 etcd 里已有同名 key。

### `GET /configs/history/{kind}/{key}`

响应 `list[]`：

| 字段 | 说明 |
|------|------|
| `id` / `configKey` | 记录主键 / 配置的 etcd key |
| `version` | 递增版本号 |
| `content` | **该版本当下的完整 YAML** |
| `actionType` | `CREATE` \| `UPDATE` \| `BASELINE` \| `DELETE` \| `ROLLBACK` |
| `operator` / `remark` / `createdAt` | 审计字段 |

### `POST /configs/rollback`

| 字段 | 类型 | 约束 |
|------|------|------|
| `kind` | string | `shared` \| `services` |
| `key` | string | 必填 |
| `version` | int | `min:1`，目标历史版本 |
| `remark` | string | 默认「回滚至版本 N」 |

响应 `{ "version": 7 }`——回滚是**一次新的发布**，版本号继续往前，不是时光倒流。选到当前版本会报 `该版本已是当前配置，请选择更早的历史版本`。

## Deploy（控制台，需 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/nodes` | 节点列表 + 在线判定 + 整机资源 |
| GET | `/nodes/recommend` | 按剩余内存与 CPU 推荐部署节点 |
| GET | `/artifacts` | 产物列表，可带 `?serviceName=` |
| POST | `/artifacts` | 上传 tar（`multipart/form-data`） |
| GET | `/deploys` | 发布任务列表，可带 `?nodeId=` |
| POST | `/deploys` | 创建发布任务 |
| POST | `/deploys/rollback` | 回滚到该节点该服务上一成功版本 |
| POST | `/deploys/promote` | 推进灰度 / 旁路转正 |
| POST | `/deploys/lifecycle` | 启停容器 |

### `NodeItem`

| 字段 | 说明 |
|------|------|
| `nodeId` `hostname` `os` `arch` | 节点身份 |
| `dockerPlatform` | `linux/amd64` \| `linux/arm64`，发布时与产物比对 |
| `dockerNetwork` `loopbackAs` | 下发给该节点容器时用 |
| `ncpu` `memoryBytes` | 总量（cgroup 限额会夹住） |
| `cpuUsedPercent` `memoryUsedBytes` `memorySource` | 整机读数；`memorySource` 缺省表示探针未上报，**不当 0% 处理** |
| `hostPorts` | 已占用宿主机端口，用于端口冲突判定 |
| `agentVersion` | 探针版本 |
| `online` | `last_seen` 距今 < 45s |
| `lastSeen` | 最后心跳时间 |
| `containers[]` | `name` `image` `status` `ports` `cpuPerc` `memUsage` `memPerc`（仅 `cc-*`） |

### `GET /nodes/recommend`

查询参数 `artifactId`（必填）、`hostPort`。

响应：`serviceName` `platform` `hostPort` `recommendedNodeId` `summary`，加 `nodes[]`，每台带 `eligible` / `recommended` / `score` / `reason`。

打分 `idleScore = 0.4 * CPU空闲率 + 0.6 * 内存空闲率`（内存宽裕时少量加分），不合格节点直接给阻塞原因。**推荐不会自动部署**，仍需人工确认下发。

### `POST /artifacts`

`multipart/form-data`：

| 字段 | 说明 |
|------|------|
| `file` | tar 文件，字段名固定 `file`，否则报 `请上传 tar 文件（字段名 file）` |
| `serviceName` `imageName` `platform` | 必填 |
| `containerPort` | 选填，`hostPort` 未填时用它 |

落盘 `deploy.artifactDir`（默认 `data/artifacts`）下 `<id>-<service>.tar`，记 sha256。受 `server.clientMaxBodySize`（默认 `512MB`）限制。

### `POST /deploys`

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodeIds` | string[] | 必填，空则 `请选择至少一个节点` |
| `artifactId` | int64 | 必填 |
| `hostPort` | int | 主容器宿主机端口，默认等于产物 `containerPort` |
| `strategy` | string | `canary`（默认）\| `all`，其它值报 `strategy 只能是 canary 或 all` |
| `canaryCount` | int | 多节点灰度先下发几台，默认 1 |
| `canaryHostPort` | int | 单节点旁路灰度端口；设置后**不替换旧容器**，以 `cc-<服务>-canary` 运行 |
| `remark` | string | 写进任务 `message` |

响应 `{ "jobIds": [12, 13] }`。

校验：节点 `last_seen` < 45s（否则 `节点 xxx 离线，请先在该机器启动 deploy-agent`）；`platformsMatch(产物, 节点)`；旁路灰度只能一台（`旁路灰度请只选一个节点`）且灰度端口 ≠ 主端口（`灰度端口不能与主端口相同`）。

任务状态：`pending` → Agent 领取 → `running` → `success` / `failed`；`strategy=canary` 时超出 `canaryCount` 的节点先落 `waiting`。`running` 超过 `deploy.jobTimeout`（默认 10m）在下一次心跳被置为 `failed`。

### `POST /deploys/rollback`

`{ nodeId, serviceName, remark }` → `{ jobId }`。取该节点该服务最近两次 `action=deploy` 且 `status=success` 的任务，用倒数第二条的产物再走一次全量发布，新任务标 `action=rollback`。不足两条报 `没有可回滚的上一成功版本`。

### `POST /deploys/promote`

`{ artifactId, remark }` → `{ jobIds }`。先找同产物的 `waiting` 任务改 `pending`；没有 `waiting` 时找该产物 `action=canary` 且 `success` 的记录，转成正式 `deploy` 并下发 `stop-canary`。两者都没有报 `没有可推进的灰度任务（无等待节点，也无成功的旁路灰度）`。

### `POST /deploys/lifecycle`

`{ nodeId, serviceName, action }`，`action` ∈ `start` | `stop` | `restart`。响应 `{ jobId }`。

`serviceName` 传**容器名去掉 `cc-` 前缀**的部分；旁路容器传 `<服务>-canary`。非法值报 `action 必须是 start / stop / restart`。

### `DeployJobItem`

`id` `nodeId` `artifactId` `serviceName` `action`（`deploy` \| `canary` \| `rollback` \| `start` \| `stop` \| `restart` \| `stop-canary`）`status` `imageName` `hostPort` `message` `operator` `createdAt` `updatedAt`。

## Agent（需 `X-Agent-Token`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/agent/heartbeat` | 上报节点事实，领取任务 |
| POST | `/agent/jobs/{id}/report` | 回写任务结果 |
| GET | `/agent/artifacts/{id}/file` | 下载 tar 原始流（**无 JSON 包装**） |

### `POST /agent/heartbeat`

| 字段 | 必填 | 说明 |
|------|------|------|
| `nodeId` | 是 | 节点唯一标识，配置中心按它 upsert |
| `hostname` `os` `arch` | | |
| `dockerPlatform` | | `docker info` 的 `{{.Os}}/{{.Architecture}}` |
| `dockerNetwork` `loopbackAs` | | 下发容器时用 |
| `ncpu` `memoryBytes` | | 整机资源（cgroup 限额夹过） |
| `agentVersion` | | 探针版本 |
| `containers[]` | | 仅 `cc-*`：`name` `image` `status` `ports` `cpuPerc` `memUsage` `memPerc` |
| `metrics` | | `{ cpuUsedPercent, memoryUsedBytes, memorySource, hostPorts[] }`；缺省时服务端记为未上报 |

响应 `{ "jobs": [JobItem] }`——该节点已有 `running` 任务时返回空数组；否则最多给 5 条 `pending`。

`JobItem`：`id` `action` `serviceName` `imageName` `artifactId` `containerName` `hostPort` `containerPort` `dockerNetwork` `loopbackAs` `etcdHost`。

### `POST /agent/jobs/{id}/report`

`{ status, message }`，`status` ∈ `running` | `success` | `failed`。

## 微服务侧接口

### `GET /api/v1/health`（所有接入 SDK 的服务）

由 `etcdcfg.BindHealth(group)` 注册。

| 字段 | 说明 |
|------|------|
| `status` | `ok` \| `degraded`（用快照启动即 `degraded`） |
| `service` | `svc.etcd.host` 的 `@` 后缀 |
| `etcd` | etcd 连接状态 |
| `configFrom` | `etcd` \| `snapshot` \| `file` |
| `database` `redis` | 合并配置里**存在该根 key 才探测**，否则 `skipped` |

字段与 `ProbeResult` 对齐，可被中台或负载均衡直接复用。

### shop-server 演示接口

`shop-server` 是示例服务，**没有挂任何鉴权中间件**，接口对外开放——照抄它做新服务时记得按需加鉴权。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/config/runtime` | 热更新验证：`shopName`（`test.shopName`，每次请求即时读）、`test` 整段、`watch` `watchShared` `stickyKeys` `configFrom` `reloadedAt` `changed` `eventKeys` |
| POST | `/api/v1/products` | 创建商品 |
| GET | `/api/v1/products` | 列表，分页 `page` `size`，过滤 `name` `status` |
| GET | `/api/v1/products/{id}` | 详情 |
| PUT | `/api/v1/products/{id}` | 更新 |
| DELETE | `/api/v1/products/{id}` | 删除 |
| GET | `/files/*` | 静态目录，映射 `data/files` |

`changed` 是最近一次热更新变更的配置路径，`eventKeys` 是触发它的 etcd key——排查「改了没生效」时先看这两个。

## 相关文档

- [架构与实现链路](architecture.md) 的 §5–§7 讲这些接口背后的调用链
- [deploy-agent](deploy-agent.md) 讲 Agent 拿到任务之后做什么
- [配置项字典](configuration.md) 讲接口写入 etcd 的那些 key
