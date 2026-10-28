# etcdcfg SDK

`pkg/etcdcfg` 是 GoFrame 微服务接入配置中心的**唯一依赖**。本地文件只留 `svc.etcd.host`，其余 `server` / `database` / `redis` 由 etcd 的 `shared/*` + `services/<服务名>` 合并下发。

怎么用（复制粘贴）见 [接入新微服务](../01-getting-started/integrate-a-service.md)；本文讲**行为和契约**。

模块路径 `configure-center/pkg/etcdcfg`，Go 1.25，直接依赖只有 `gogf/gf/v2` 和 `go.etcd.io/etcd/client/v3`。协议是 **gRPC（`clientv3`）**，不是 HTTP。

## 公开 API

| 函数 | 位置 | 说明 |
|------|------|------|
| `Boot(ctx) error` | `boot.go:11` | 读本地 `svc.etcd.*`，构造 Adapter 并 `g.Cfg().SetAdapter` |
| `BootFromLocal(ctx) (*Adapter, error)` | `boot.go:18` | 同 `Boot`，额外返回 Adapter，供自定义探活 |
| `NewClient(ctx, Options) (*Client, error)` | `client.go:55` | 建 etcd 客户端并 ping。**配置中心用这个**，不用 Boot |
| `NewAdapter(ctx, Options) (*Adapter, error)` | `adapter.go:60` | 手工构造 Adapter |
| `BindHealth(group)` | `health.go:46` | 在路由组上挂 `GET /health` |
| `NewHealth() *Health` | `health.go:31` | 需要单独 Bind 时用 |
| `Probe(ctx) ProbeResult` | `probe.go:28` | 统一探活结果，自定义健康检查复用 |
| `Current() (*Adapter, bool)` | `current.go` | 从 `g.Cfg().GetAdapter()` 类型断言取回 Adapter |
| `Runtime() (RuntimeInfo, bool)` | `current.go` | 取热更新状态，**不触发重载** |
| `ParseHost(string) (ParsedHost, error)` | `host.go:28` | 解析 `ip:port[,ip:port]@服务名` |

`Client` 上的方法：`Get` `Put` `Delete` `ListPrefix` `ListShared` `ListServices` `GetShared` `GetService` `PutShared` `PutService` `DeleteShared` `DeleteService` `PutIfAbsent` `LoadMerged` `LoadMergedYAML` `Endpoints` `Prefix` `Ping`。

`PutIfAbsent` 用 etcd Txn 判 `CreateRevision == 0`（`client.go:223`），是 seed 不覆盖已有配置的实现基础。

## Options

`Boot` 从本地 `svc.etcd.*` 读取，也可直接构造传给 `NewAdapter` / `NewClient`。

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `Host` | string | 必填 | `ip:port[,ip:port]@服务名`，多地址用逗号分隔 |
| `Username` / `Password` | string | 空 | etcd 开启 RBAC 后填只读账号 |
| `Prefix` | string | `/config-center` | key 根路径，自动补前导 `/`、去尾部 `/` |
| `Watch` | bool | `true` | 监听 etcd 并热更新内存快照，不重启进程 |
| `SkipSharedWatch` | bool | `false` | `true` 时不消费 `shared/*` 变更 |
| `StickyKeys` | []string | 空 | **不参与热重载**的根 key |
| `SnapshotDir` | string | `data/config-cache` | 合并后 YAML 的容灾目录 |
| `LoopbackAs` | string | 空 | 把合并配置里的 `127.0.0.1` 替换成这个主机名 |
| `DialTimeout` | duration | `5s` | etcd 拨号超时 |

`Host` 的 `@服务名` 是**业务微服务**的必填项；配置中心自己不加（`ParseHost` 允许省略，`Boot` 会报 `微服务的 svc.etcd.host 必须为 ip:port@服务名`）。

## Key 布局

```
<prefix>/shared/<name>       公共配置，所有服务合并
<prefix>/services/<name>     单个服务的专属配置
```

默认 `<prefix>` = `/config-center`。`keys.go` 的 `SharedKey` / `ServiceKey` 负责拼接，`name` 会去掉首尾 `/`。

## 合并算法

`LoadMerged`（`client.go:234`）三步：

1. `Get` 前缀 `<prefix>/shared/` 下**所有** key，按名称顺序 `deepMerge` 成一张 map
2. `Get` `<prefix>/services/<本服务>`，同样 `deepMerge` **覆盖**在上面
3. 结果 map 同时序列化成 YAML 落快照，并包成 `gjson` 供点号路径查询

`deepMerge`（`merge.go:16`）递归合并 map：同名 key 若两边都是 map 则继续下钻，否则**服务配置整体替换公共配置的值**。这意味着服务里写一个不完整的 `database.default` 会**丢掉公共配置里同级的其它字段**——服务配置要覆盖某一段时，把那一段写全。

顺序查询规则：`g.Cfg().Get(ctx, "database.default.link")` → 先查 `database.default.link` 这个完整路径，取不到则回退 `database.default` → 再回退 `database` → 最后整个合并 map。

**没有** `config_info` 之类的数据库双写。etcd 是唯一运行时真相源。

## 启动降级阶梯

`NewAdapter`（`adapter.go:60`）的顺序：

| 情况 | 行为 | `configFrom` | `status` |
|------|------|--------------|----------|
| etcd 连通 + 拉取成功 | `reload()` → 合并 → 改写 loopback → 原子写快照 → 起 Watch | `etcd` | `ok` |
| **etcd 拨号失败**，快照存在 | `loadFromSnapshot()` + 后台每 5s `startReconnect` | `snapshot` | `degraded` |
| etcd 连通但**首次拉取失败**，快照存在 | 同上 | `snapshot` | `degraded` |
| etcd 失败且**无快照** | 返回 error，进程启动失败 | — | — |
| 未调用 `Boot`（直接用文件 Adapter） | GoFrame 默认行为 | `file` | — |

最后一行是刻意的：**没有快照又没有 etcd，宁可启动失败也不要带着半套配置上线**。这也是容器部署时 `snapshotDir` 必须挂持久卷的原因。

重连成功后 Adapter 会把 `source` 切回 `etcd` 并重新合并，不需要重启进程。

## 热重载的边界

Watch 事件到内存生效的完整路径（`adapter.go`）：

```
startWatch (L315)
  ├─ goroutine watchLoop(<prefix>/shared/, WithPrefix)   仅当 watchShared
  ├─ goroutine watchLoop(<prefix>/services/<本服务>)      精确 key
  └─ goroutine debounceLoop (L377)                       150ms 合并一批事件
        └─ reload(eventKeys) (L253)
             1. shouldSkipReload —— 事件全部命中 sticky 的 shared 名 → 整次跳过
             2. LoadMerged + applyLoopback + persistMerged（原子写快照）
             3. applySticky —— sticky 根 key 保留内存旧值
             4. changedKeys / splitChanged —— 记录变更路径与触发 key
             5. 把新的不可变 *snapshot 原子换进 gvar
```

三条硬边界：

1. **只改内存。** 不重启 HTTP 服务、不重绑端口、不重建 DB / Redis 连接池。连接池在第一次 `g.DB()` 时按当时配置建立，之后 etcd 改 DSN 也不会让已有连接变化。换连接串要滚动重启。
2. **`stickyKeys` 为空 ⇒ 全部热重载**，包括 `database`、`logger`、`server`。列进 `stickyKeys` 的**根 key** 冻结在启动时的值，etcd 变更不会写进内存快照。
3. **快照文件写的是未 sticky 的完整合并结果。** sticky 只影响本次运行期的内存值，不影响灾备文件——下次冷启动仍然拿到最新全量配置。

性能：`shouldSkipReload`（`diff.go:105`）让「只动了 sticky 的公共配置」这种事件**完全不拉 etcd**；150ms 防抖把一批快速变更合并成一次重载。

### 为什么 Watch 拆成两个 watcher

不是随手写的。生产 etcd 开 RBAC 后，微服务账号**不能** `Watch /config-center/` 整棵树——那会读到别的服务的配置。拆成「`shared/` 前缀 + 本服务精确 key」之后，可以给单个服务只授这两条路径的 `read` 权限。脚本见 `configure-server/scripts/etcd-rbac.sh`，理由见 [设计决策记录 D-03](../03-development/design-decisions.md#d-03-etcd-账号严格只读且-watch-拆成两个前缀)。

`SkipSharedWatch: true` 时第一个 watcher 不启动，服务只跟自己的配置；此时公共配置变更不会热更新。

### `Watch: false` 的读取路径

`Adapter.Get` / `Data`（`adapter.go:160`/`177`）在 `Watch=false` 且查询路径**不属于 sticky** 时**绕过内存缓存，直接实时读 etcd**。也就是说关掉 Watch 不等于冻结配置，只是不再接收推送、改成每次现拉。

## 快照文件

- 路径 `<SnapshotDir>/<服务名>.snapshot.yaml`，**文件名固定、直接覆盖**——冷启动时不需要挑最新的一份。
- `atomicWriteFile`（`snapshot.go:17`）写临时文件再 `rename`，失败带重试。目的是崩溃或并发读时不会看到写了一半的 YAML。
- 默认目录 `data/config-cache`，容器部署时挂成持久卷（Agent 已经这么做，见 [deploy-agent](deploy-agent.md)）。

## loopbackAs

`applyLoopback`（`merge.go:118`）递归遍历合并后的 map，把所有形如 `127.0.0.1:port` 的地址主机名替换成 `LoopbackAs`（Docker 容器里通常是 `host.docker.internal`）。

这一步发生在**写快照之前**，所以磁盘快照里也是改写后的地址，容器用快照冷启动时同样能连到宿主机。

由 deploy-agent 在生成实例配置时写入 `svc.etcd.loopbackAs`；本机 `go run` 不需要设置。

## 探活契约

`Probe(ctx)`（`probe.go:28`）返回 `ProbeResult`，`health.go` 的 `GET /health` 字段与它一一对齐：

| 字段 | 取值 |
|------|------|
| `status` | `ok` \| `degraded`（`degraded` = 用了快照） |
| `service` | `@` 后缀的服务名 |
| `etcd` | 连接状态 |
| `configFrom` | `etcd` \| `snapshot` \| `file` |
| `database` | `ok` / `failed` / **`skipped`** |
| `redis` | 同上 |

`database` 与 `redis` **只在合并配置里存在对应根 key 时才探测**。没配 `database` 的服务返回 `skipped`，不是失败。这让同一个 `BindHealth` 能被任意形态的 GoFrame 服务复用，也方便负载均衡直接读。

## RuntimeInfo

`Runtime()` / `Adapter.RuntimeInfo()` 返回：

| 字段 | 说明 |
|------|------|
| `watch` | 是否启用 Watch |
| `watchShared` | 是否监听 `shared/`（受 `SkipSharedWatch` 影响） |
| `stickyKeys` | 冻结的根 key |
| `source` | `etcd` \| `snapshot` |
| `snapshotPath` | 快照文件绝对/相对路径 |
| `reloadedAt` | 最近一次热重载时间 |
| `changed` | 最近一次变更的**配置路径**列表 |
| `eventKeys` | 触发本次重载的 **etcd key** 列表 |

排查「改了配置没生效」的顺序：`eventKeys` 有没有 → 说明 Watch 到没到；`changed` 有没有 → 说明合并后值有没有变；`stickyKeys` 里有没有该根 key → 说明是不是被冻结了。

shop-server 的 `GET /api/v1/config/runtime` 就是把这个结构加上业务字段暴露出来，当演示用。

## 集成约束

- **不要在 `init()` 里 Boot。** 放 `cmd` 函数体第一行，失败 `return err` 而不是 `log.Fatalf`。见 [设计决策记录](../03-development/design-decisions.md)。
- **必须早于第一次 `g.Server()` / `g.DB()` / `g.Redis()`。**
- 服务名四处一致：`@` 后缀 = etcd `services/<名>` = 中台服务 key = `catalog.name` = 容器 `cc-<名>`。
- 独立仓库把 `replace configure-center/pkg/etcdcfg => <路径>` 指到本仓库的 `pkg/etcdcfg`。
- 单元测试不联网：SDK 自带的测试（`merge_test.go`、`diff_test.go`、`host_test.go`、`probe_test.go`、`snapshot_test.go`、`yaml_merge_test.go`）全部离线跑，合并与 diff 逻辑不依赖 etcd 客户端。见 [测试](../03-development/testing.md)。

## 相关文档

- [配置项字典](configuration.md) —— `svc.etcd.*` 完整说明
- [架构与实现链路](architecture.md) §5 —— 热更新整条链路
- [接入新微服务](../01-getting-started/integrate-a-service.md) —— 复制粘贴版
