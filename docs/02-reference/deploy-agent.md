# deploy-agent

节点探针。职责很窄：**替这台机器执行 docker 命令，并把机器事实报给配置中心**。它不监听端口、不连数据库、不做配置管理。

版本常量 `version = "0.4.0"`（`deploy-agent/main.go:23`），随心跳上报为 `agentVersion`。

模块只依赖 `github.com/gogf/gf/v2`，且**只用它读本地 yaml 和打日志**。不用 Docker SDK——所有 docker 操作走 `exec.Command("docker", ...)`（`internal/dockerx/docker.go:11`），前提是这台机器的 `docker` CLI 可用且进程有权限。

## 为什么不用容器跑探针

见 [内网 ARM64 离线部署](../01-getting-started/deploy-offline-arm64.md#1-探针为什么用-systemd)。核心两条：容器里读到的 CPU/内存是探针自己的 cgroup 配额，节点推荐会失真；Agent 写下的挂载路径必须是 dockerd 看到的宿主机路径。

## 心跳循环

`main.go:46` 的 `run` → 每 `agent.interval`（默认 10s）一轮 `tick`：

```
1. dockerx.Info()                    docker info --format  取 NCPU / MemTotal / OSType / Architecture / platform
2. dockerx.ListContainers()          docker ps -a --filter name=cc- --format ...
3. dockerx.Stats(names)              docker stats --no-stream  填每容器 cpuPerc / memUsage / memPerc
4. hostmetrics.Collect()             /proc/meminfo、/proc/stat、cgroup v2
5. hostmetrics.Quota()               把 ncpu / 内存夹到 cgroup 限额
6. dockerx.MemoryUsedBytes()         取不到整机内存时的回退（memorySource = "containers"）
7. dockerx.PublishedHostPorts()      已发布到宿主机的端口，用于冲突判定
8. POST /api/v1/agent/heartbeat  +  X-Agent-Token
9. 返回的 jobs[] 逐条 handleJob
```

**只有 `cc-` 前缀的容器会上报**。配置中心自己的容器不要用 `cc-` 前缀，否则会被当成业务容器出现在节点页、并被生命周期操作波及。

`metrics` 缺省时服务端记为「未上报」（列默认 `-1`），**不当作 0% 空闲**——否则数据缺失的机器会在节点推荐里排到最前面。

## 任务动作

`handleJob`（`main.go:160`）先无条件回写 `running`，再按 `action` 分派：

| action | docker 命令 | 成功 message |
|--------|-------------|--------------|
| `stop` | `docker stop <name>` | `stopped cc-<svc>` |
| `start` | `docker start <name>` | `started cc-<svc>` |
| `restart` | `docker restart <name>` | `restarted cc-<svc>` |
| `stop-canary` | `docker rm -f <name>` | `removed cc-<svc>-canary` |
| `deploy` / `rollback` / `canary` | 见下 | `started <name> (health ok, port N)` |
| 其它 | — | 报错 `未知动作 <action>` |

容器名来自任务里的 `containerName`，缺省时按 `cc-<serviceName>` 推导。

`stop` / `start` / `restart` 只作用于**已存在的容器**，不会重新 `docker run`，因此也不会重写实例配置。

## 发布一个镜像

`deployImage`（`main.go:192`）完整八步：

### 1. 记下旧镜像

```go
prevImage, _ := dockerx.InspectImage(containerName)   // docker inspect --format {{.Image}}
```

这是自动回滚的唯一依据。首次部署时为空。

### 2. 下载 tar

`GET /api/v1/agent/artifacts/{id}/file` + `X-Agent-Token` → 临时文件 `artifact-*.tar`，用完 `os.Remove`。非 200 直接把响应体拼进错误信息。

### 3. `docker load -i <tar>`

### 4. `docker rm -f <容器名>`

旧容器**直接删掉**——不是滚动、不是优雅停止。业务要平滑下线得靠上游网关切流，探针不做这件事。

### 5. 写实例配置

目录 `data/instances/<服务>/`（旁路灰度是 `data/instances/<服务>-canary/`），下面两个子目录：

```
config/config.yaml    → 挂进容器 /app/manifest/config/config.yaml:ro
cache/                → 挂进容器 /app/data/config-cache（快照目录，必须持久化）
```

`config.yaml` **内容由探针生成，只有 etcd 入口**：

```yaml
svc:
  etcd:
    host: "host.docker.internal:2379@shop-server"
    watch: true
    snapshotDir: data/config-cache
    loopbackAs: "host.docker.internal"
```

`host` 来自任务里的 `etcdHost`，`loopbackAs` 优先用任务值、空则回退 `agent.loopbackAs`（再空则 `host.docker.internal`）。

**业务配置一律不进这个文件**——容器起来后由 SDK 从 etcd 拉。这就是「发镜像不改配置、改配置不发镜像」能成立的物理原因。

### 6. `docker run`

`RunDetached`（`internal/dockerx/docker.go:144`）拼出的完整命令：

```bash
docker run -d \
  --name cc-<服务> \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -e TZ=Asia/Shanghai \
  -p <hostPort>:<containerPort> \
  -v <absDataDir>:/app/data/config-cache \
  -v <absCfgFile>:/app/manifest/config/config.yaml:ro \
  [-v /etc/ssl/certs:/etc/ssl/certs:ro] \
  [--network <dockerNetwork>] \
  <imageName>
```

- `/etc/ssl/certs` 只在宿主机存在该目录时挂（`scratch` 镜像没有 CA 根证书，容器要访问 HTTPS 依赖这个）。
- `containerPort` 缺省 8000，`hostPort` 缺省等于 `containerPort`。
- `dockerNetwork` 优先任务值，空则回退 `agent.dockerNetwork`。
- 挂载路径用**绝对路径**（`filepath.Abs`），因为 dockerd 按宿主机路径解析。

### 7. 健康探测

`dockerx.WaitHealthy(hostPort, healthPath, healthTimeout, healthInterval)`（`internal/dockerx/health.go`）：

1. 先 TCP 拨 `127.0.0.1:<hostPort>`
2. `healthPath` 非空时再发 `GET http://127.0.0.1:<hostPort><healthPath>`
3. **状态码 200–399 都算健康**；4xx/5xx 和连不上都算失败（4xx 通常是 `healthPath` 配错，不能当成健康）
4. 每 `healthInterval`（默认 2s）重试，最长 `healthTimeout`（默认 90s）

`healthPath` 不以 `/` 开头会自动补。每次探测独立判定，失败按 `healthInterval` 重试，直到 `healthTimeout`。

### 8. 失败自动回滚

主容器 `docker run` 失败或探测失败时：

```
docker rm -f <容器>
if prevImage != "":          # prevImage 是 docker inspect {{.Image}} 的 sha256，不是 tag
    docker run 用 prevImage 重新拉起（同样的挂载与端口）
    WaitHealthy(..., 20s, ...)
    ├─ 成功 → 任务 failed，message "...auto rolled back to previous image <id> (端口 N 已恢复)"
    └─ 失败 → 任务 failed，message "...rolled back to <id> but it is also unhealthy"
else:
    任务 failed，message "...no previous version to roll back (首次部署，失败容器已清理)"
```

**旁路灰度（`action=canary`）不回滚**——它不在主端口上，失败时保留旁路容器供排查，只在 message 里说明「旁路容器保留，不影响主容器」。

## 长任务保活

下载/加载/健康探测期间主循环是阻塞的，Agent 每 30 秒额外：

- `POST /agent/jobs/{id}/report` 上报 `running`，刷新任务的 `updated_at`，避免服务端按 `jobTimeout` 误回收；
- `POST /agent/heartbeat` 带 `keepalive: true`，只刷新节点 `last_seen`，避免节点页显示离线。

## 端口冲突诊断

`docker run` 失败时 `wrapBindError`（`internal/dockerx/port.go`）会用平台相关命令查是谁占了端口：

| 平台 | 命令 |
|------|------|
| Windows | `netstat -ano` |
| Linux | `ss -lptn` |
| macOS | `lsof -i` |

结果拼进原始错误，回写到任务 `message`，中台发布页直接可见。最常见的场景是开发机上 `go run` 的业务进程占了 8000，与 `cc-shop-server` 抢端口。

## 资源采集

`internal/hostmetrics`：

| 文件 | 内容 |
|------|------|
| `sample.go` | `Collect()` 汇总整机读数 |
| `parse.go` | 解析 `/proc/meminfo`（用 `MemAvailable` 不是 `MemFree`）、`/proc/stat`、cgroup v2 的 `memory.max` / `cpu.max` / `cpu.stat` |
| `cgroup_linux.go` / `cgroup_other.go` | cgroup 限额读取，按平台构建标签分文件 |
| `memory_linux.go` / `memory_windows.go` / `memory_other.go` | 已用内存，按平台取不同来源 |

`Quota()` 把上报的 `ncpu` / `memoryBytes` 夹到 cgroup 限额内——**即使探针本身跑在容器或 systemd 的资源限制里，报出去的也是它实际能用的量**。

`memorySource` 两种值：`host`（整机内存，推荐算法可用）/ `containers`（仅 `cc-*` 容器合计，回退）。

## 配置

见 [配置项字典](configuration.md#deploy-agent)。工作目录必须是探针所在目录，否则读不到 `manifest/config/config.yaml`。

```bash
cd deploy-agent
go run .              # 默认 nodeId=win-local，连 http://127.0.0.1:9000
```

交叉编译（内网机器用，**不要打成镜像**）：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o deploy-agent-linux-arm64 .
```

生产建议 systemd 托管（完整单元文件见 [离线部署 §8](../01-getting-started/deploy-offline-arm64.md#8-安装探针systemd)）：`After=docker.service` + `Requires=docker.service` + `Restart=always`，以 root 运行才能调 `docker`。

## 安全边界

| 事实 | 影响 |
|------|------|
| `X-Agent-Token` 是**单令牌、全节点共享**，不是每节点一个 | 拿到令牌 = 能在任意已注册节点上 `docker rm -f` + `docker run`。这是高权限凭据，不要下发给业务方 |
| 令牌**明文**写在两个 `config.yaml` 里 | 两边都已 gitignore，但运维分发时别贴进工单或聊天记录 |
| 探针以 root 运行 | 它能改本机所有 `cc-*` 容器；挂载路径来自配置中心下发，等于配置中心对本机有 docker 级控制权 |
| 配置中心地址走 HTTP | 跨网段部署应在链路上加 TLS 终止（反向代理）或走内网隔离 |
| 只连出站、不监听端口 | 不需要给节点开入站防火墙规则，这是它比 SSH 部署更安全的一面 |

轮换令牌的正确顺序：改配置中心 `auth.agentToken` → 重启配置中心 → 逐台改 `agent.token` → `systemctl restart deploy-agent`。中间窗口内旧令牌立刻失效，节点页会显示离线、发布被拒绝，属正常。

## 相关文档

- [打包与发布](../01-getting-started/release-and-rollout.md) —— 从使用中台的角度
- [HTTP API 参考 §Agent](api.md#agent需-x-agent-token) —— 心跳与回写的字段定义
- [数据库表结构](database-schema.md#deploy_nodes--节点心跳) —— 心跳落到哪些列
