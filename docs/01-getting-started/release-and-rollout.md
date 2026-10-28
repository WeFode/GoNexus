# 打包与发布

从开发机出 tar，到中台把容器跑起来。**发布链路和配置热更新完全独立**：发镜像不会改 etcd 里的业务配置，改配置也不需要重新发镜像。

## 打包（开发机）

```powershell
# 仓库根目录
.\package.ps1                                # catalog 里的全部服务
.\package.ps1 -Service shop-server           # 只打一个
.\package.ps1 -Platform linux/arm64          # ARM 机器必须指定
.\package.ps1 -OutDir D:\out                 # 改输出目录
```

Linux/macOS 用等价的 `./package.sh`。

脚本对每个 `deploy/catalog.json` 里的服务做五步：

1. `CGO_ENABLED=0 GOOS=linux GOARCH=<arch> go build -ldflags="-s -w"` 交叉编译出 `main`
2. 把该模块的 `config.example.yaml` 复制成 `config.yaml`（**注意不是 `config.yaml`**，仓库里的本地配置不会进镜像）
3. 有 `manifest/etcd-seed` 的话一并拷进去（只有 configure-server 有）
4. `docker build --platform <plat> -f deploy/runtime.Dockerfile`——`FROM scratch`，产物只有 `/app/main` + 引导配置 + seed
5. `docker save` 出 `deploy/dist/<服务>-<平台>.tar`，旁边写一份 `<服务>-<平台>.json` 元数据

`pkg/etcdcfg` 在 `go build` 时静态链进 `main`，**镜像里没有 `pkg/` 目录，也不需要挂载它**。

### 平台必须匹配

漏掉 `--platform` 时 Docker Desktop 会按 amd64 存，ARM 机器 `docker load` 后报 `exec format error`。发布时服务端会拦：产物的 `platform` 与节点上报的 `docker_platform` 不一致就直接拒绝创建任务。检查已导出的镜像：

```powershell
docker image inspect --format "{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}" configure-server:linux-arm64
```

### 单模块打包（make）

```bash
cd configure-server && make package   # → ../deploy/dist/configure-server-image.tar
cd shop-server      && make package
```

走的是各模块自己的 `Dockerfile`，产物名带 `-image` 后缀，与中台「发布」页约定的 `<服务>-<平台>.tar` 命名不同。走中台发布请用根目录的 `package.ps1` / `package.sh`。

## 上传产物

中台「发布」页上传 tar，或：

```bash
curl -X POST http://127.0.0.1:9000/api/v1/artifacts \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@deploy/dist/shop-server-linux-arm64.tar \
  -F serviceName=shop-server \
  -F imageName=shop-server:linux-arm64 \
  -F platform=linux/arm64 \
  -F containerPort=8000
```

服务端落盘到 `configure-server/data/artifacts/<id>-<service>.tar`，记 sha256 和元数据进 `deploy_artifacts`。文件名里的 `linux-arm64` 会被识别成平台 `linux/arm64`、镜像 `shop-server:linux-arm64`——**内网场景请保持这个文件名上传**。

`server.clientMaxBodySize` 默认 `512MB`，更大的 tar 要先改配置中心本地配置。

发布页从上到下就是这条流程：上传产物 → 选产物 → 选在线节点 → 确认发布；中间两条彩色横幅是等待人工推进的灰度任务，最下面是每 6 秒刷新一次的发布任务表。

![发布页（截图来自 mock 后端，服务名、镜像、节点与时间均为虚构）](../assets/screenshots/deploys.png)

## 发布策略

发布页负责的是**把镜像在哪些机器上跑起来、跑在哪个端口**，不是切用户流量。

| 策略 | 行为 | 任务状态 |
|------|------|----------|
| **全量**（`strategy: all`） | 选中节点同时替换主容器 `cc-<服务>` | 全部 `pending` |
| **灰度·多节点**（`strategy: canary` + `canaryCount`） | 前 N 台先下发，其余排队 | 前 N 台 `pending`，其余 `waiting` |
| **灰度·单节点旁路**（填 `canaryHostPort`） | 旧容器不动，新版本以 `cc-<服务>-canary` 跑在旁路端口 | 一条 `pending`，`action=canary` |

约束（服务端直接校验，违反会拒绝创建任务）：

- 旁路灰度**只能选一个节点**，且灰度端口不能等于主端口。
- 节点必须在线：`last_seen` 距今 **45 秒内**（约 4 次心跳）。
- 产物平台与节点 Docker 平台必须一致。
- 同一节点已有 `running` 任务时，心跳不会派新活。
- `hostPort` 不填则默认等于产物的 `containerPort`。

`running` 任务超过 `deploy.jobTimeout`（默认 10m）没回写结果，会在下一次该节点心跳时被置为 `failed`。

## 灰度 ≠ 流量灰度

这是最容易误解的地方。发布页点「灰度」之后，**没有任何用户请求会打到新容器**——用户仍然走原来的地址。真正的用户无感切分要由 API Gateway 做：

1. 旧实例继续在主端口提供服务。
2. 发布页用旁路端口拉起新 tar（`cc-<服务>-canary`）。
3. 在配置中心写**网关路由**（白名单 user / IP / Header，或百分比），网关 Watch etcd 后只把命中名单的请求转到 canary 端口。
4. 验证通过 → 网关切到 100% 新版本 → 回发布页「转正」替换主容器、下线 canary。失败 → 关掉白名单，旧实例一直在跑。

**本仓库目前没有网关进程。** `shop-server` 不会自己按白名单把流量分给另一份自己。白名单配置要给独立的 gateway 服务读，不要写在业务服务的配置里。

## 转正与推进

- **多节点灰度**：金丝雀验证通过后点「推进其余节点」，把所有 `waiting` 任务改成 `pending` 下发。
- **单节点旁路**：点「转正」会把旁路 canary 变成一次正式的 `deploy`（替换主容器），并额外下发 `stop-canary` 清理旁路容器。

## 回滚

**镜像回滚**：`POST /api/v1/deploys/rollback`（节点页/发布页），逻辑是找该节点该服务最近两次 `action=deploy` 且 `status=success` 的任务，用倒数第二条的产物重新走一次全量发布，并把新任务标成 `action=rollback`。只有一次成功部署记录时会报「没有可回滚的上一成功版本」。

**Agent 侧自动回滚**：`docker run` 之后探针会按 `agent.healthTimeout`（默认 90s）轮询 `agent.healthPath`（默认 `/api/v1/health`，先 TCP 后 HTTP，状态码 <500 算健康）。探测失败会 `docker rm -f` 新容器、用 `run` 之前 `InspectImage` 记下的旧镜像重新拉起，再把任务回写成 `failed` 并附 `rolled back` 说明。

**配置回滚**是另一套：每次保存会把修改**前**的 YAML 补进 `config_history`，历史里点旧版本回滚会追加一条新版本号（不是时光倒流）。当前版本不能回滚，它已经是线上内容。见 [HTTP API 参考](../02-reference/api.md)。

## 节点推荐

发布页选定产物后可以按资源挑机器：

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:9000/api/v1/nodes/recommend?artifactId=3&hostPort=8000"
```

返回每台节点的 `eligible` / `score` / `reason`，以及唯一推荐的 `recommendedNodeId` 和一句 `summary`。打分只看**剩余内存和 CPU**：

```
idleScore = 0.4 * cpu空闲率 + 0.6 * 内存空闲率（+ 内存足够宽裕时的少量加分）
```

内存权重高于 CPU——配置中心场景下容器更容易先撑爆内存。不合格节点直接给出阻塞原因（离线 / 平台不符 / 端口被占 / 内存不足），**不会自动部署**，确认后仍需手动下发。

> Agent 没上报 `metrics` 时服务端记为「未上报」，不当作 0% 占用，推荐会说明数据缺失。QPS 和延迟不在这里，应走 Prometheus。

![节点推荐（截图来自 mock 后端，节点与资源数字均为虚构）](../assets/screenshots/recommend.png)

## 启停与重启

节点页对已发布容器可以「启动 / 停止 / 重启」，`POST /api/v1/deploys/lifecycle`，Agent 侧对应 `docker start` / `stop` / `restart`。`serviceName` 传容器名去掉 `cc-` 前缀的部分，旁路容器传 `<服务>-canary`。

![节点页（截图来自 mock 后端，节点名与容器均为虚构）](../assets/screenshots/nodes.png)

## 一次完整发布（内网 ARM64 为例）

```powershell
# 开发机
.\package.ps1 -Service shop-server -Platform linux/arm64
# → deploy\dist\shop-server-linux-arm64.tar，U 盘拷进内网
```

```bash
# 内网机器：探针已在跑
systemctl is-active deploy-agent     # active
```

中台「发布」页 → 上传 tar（保持文件名）→ 选节点 `arm64-1` → 宿主机端口 `8000` → 下发 → 任务从 `pending` 变 `running` 再变 `success`。

**不要在服务器上对业务服务手工 `docker run`。** 手工起的容器若不带 `cc-` 前缀，探针看不到它，节点页和回滚都对不上账。

```bash
curl -sS http://127.0.0.1:8000/api/v1/health   # configFrom = etcd
docker ps --filter name=cc-shop-server
```

## 相关文档

- 探针协议、docker 命令与健康探测细节：[deploy-agent](../02-reference/deploy-agent.md)
- 发布相关四张表：[数据库表结构](../02-reference/database-schema.md)
- 内网从零部署：[内网 ARM64 离线部署](deploy-offline-arm64.md)
- 任务状态与接口字段：[HTTP API 参考](../02-reference/api.md)
