# 测试

## 现状

33 个测试，**全部离线**，在 Windows 上整轮约 1 秒。

```bash
cd C:/LWF/configure-center
go test ./pkg/etcdcfg/... ./configure-server/internal/logic/... ./deploy-agent/internal/...
```

实测结果：

| 包 | 耗时 |
|----|------|
| `configure-center/pkg/etcdcfg` | 0.36s |
| `configure-server/internal/logic/config` | 0.14s |
| `configure-server/internal/logic/deploy` | 0.24s |
| `deploy-agent/internal/dockerx` | 0.19s |
| `deploy-agent/internal/hostmetrics` | 0.09s |

**不需要 etcd、Postgres、Redis、Docker 或网络。** 测试不覆盖 controller、DAO、HTTP 中间件、真实 etcd 读写和 docker 执行。

## 覆盖范围

### `pkg/etcdcfg`

| 文件 | 测什么 |
|------|--------|
| `diff_test.go` | `TestChangedKeys`、`TestApplySticky`、`TestSplitChanged`、`TestShouldSkipReload`、`TestRelevantKey` —— 热重载的跳过判定与 sticky 冻结 |
| `host_test.go` | `TestParseHost`（多地址、缺 `@`、非法输入）、`TestDeepMerge` |
| `merge_test.go` | `TestApplyLoopback` —— `127.0.0.1` 递归改写 |
| `yaml_merge_test.go` | `TestYamlToMapMerge` —— YAML 解析后深层合并 |
| `snapshot_test.go` | `TestAtomicWriteFile`（临时文件 + rename）、`TestSnapshotFileName`（固定文件名） |
| `probe_test.go` | `TestCurrentWithoutAdapter`、`TestProbeWithoutAdapter`、`TestHasRootEmpty` —— 未 Boot 时不 panic |

这一层最值得测：合并语义和 sticky 判定是纯函数，一旦改坏，线上表现是「配置没生效」这种最难查的问题。

### `configure-server`

| 文件 | 测什么 |
|------|--------|
| `internal/logic/config/history_test.go` | `TestShouldWriteBaseline` —— 首次修改前是否补录变更前快照 |
| `internal/logic/deploy/platform_test.go` | `TestNormalizePlatform`（`amd64`/`x86_64` → `linux/amd64`）、`TestContainerName`（`cc-<svc>`、`cc-<svc>-canary`） |
| `internal/logic/deploy/recommend_test.go` | `TestRankPicksFreerNode`、`TestRankSkipsBlockedNodes`、`TestRankStoppedContainerStillEligible`、`TestUnknownUsageIsNotTreatedAsIdle`、`TestUnknownUsagePrefersLargerMachine`、`TestContainerMemorySourceWording` |

`recommend_test.go` 是这套测试里最关键的一组：**资源数据缺失时不能当作 0% 空闲**。这条不变量一旦破，节点推荐会把没上报指标的机器排在第一，把不够用的机器选中部署。

### `deploy-agent`

| 文件 | 测什么 |
|------|--------|
| `internal/dockerx/port_test.go` | `TestParseListeningPIDs`、`TestIsBindError` —— 端口冲突诊断 |
| `internal/dockerx/usage_test.go` | `TestParsePublishedPorts`、`TestSumMemUsage` —— `docker` 输出解析 |
| `internal/hostmetrics/parse_test.go` | `TestParseMeminfo`、`TestParseProcStat`、`TestUsagePercent`、`TestParseCgroupQuota`、`TestSameDomain` |
| `internal/hostmetrics/memory_windows_test.go` | `TestMemoryStatusExSize` —— Windows `GlobalMemoryStatusEx` 结构体尺寸（布局错了读出来是垃圾值） |

`internal/dockerx/health.go`（TCP + HTTP 健康探测）目前**没有测试**。

## 为什么单测不连 etcd

因为 `etcdcfg.Boot` **不在 `init()` 里**。

如果 Boot 放在 `init()`（或 `main.go` 空白 import 一个带 `init()` Boot 的包），那么只要 `go test` 编译到这个包，`init()` 就会执行、强行联网连 etcd，断网环境下所有测试挂掉。搬进 `cmd` 函数体之后，单测根本不会触发这个网络请求。

这是接入规范里最重要的一条硬规则，理由见 [设计决策记录 D-04](design-decisions.md#d-04-boot-为什么从-init-搬到-cmd)。

同理，SDK 的核心逻辑（`deepMerge`、`applySticky`、`changedKeys`、`ParseHost`、`atomicWriteFile`）都设计成不依赖 `*clientv3.Client` 的纯函数或本地文件操作，才能这样测。

## 怎么加测试

优先给**纯逻辑**加：

| 想测的东西 | 放在哪 | 做法 |
|------------|--------|------|
| 合并 / sticky / diff / loopback 行为 | `pkg/etcdcfg/*_test.go` | 直接构造 map，调 `deepMerge` / `applySticky` / `shouldSkipReload` |
| 平台匹配、容器名、推荐打分 | `internal/logic/deploy/*_test.go` | 构造 `RecommendNode` 切片调 `rank`；**不要起 DB** |
| 是否补录 BASELINE | `internal/logic/config/history_test.go` | 调 `shouldWriteBaseline` |
| docker / proc 输出解析 | `deploy-agent/internal/*` | 把命令输出作为字符串喂给解析函数 |

模式：把「解析命令输出」「计算」这类逻辑留在纯函数里，把「执行 `docker`」「读写 etcd」放在薄壳里。**测试打纯函数那一层，不 mock 外部系统。**

现有测试没有一个用 mock 框架，也不要引入——需要 mock etcd 客户端才能测的逻辑，通常说明该把那段逻辑抽成纯函数。

## 端到端怎么验

目前**没有**集成测试。改动涉及 etcd 交互或发布链路时按这个手工清单：

```bash
cd configure-server && make docker-up && make run
cd ../shop-server && make run

# 1. 配置来源
curl -sS http://127.0.0.1:8000/api/v1/health          # configFrom=etcd

# 2. 热更新：改 etcd 里的 test.shopName，不重启 shop-server
curl -sS -X PUT http://127.0.0.1:9000/api/v1/configs/services/shop-server \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"server:\n  address: \":8000\"\ntest:\n  shopName: pear\n"}'
curl -sS http://127.0.0.1:8000/api/v1/config/runtime  # shopName=pear，changed 含 test.shopName

# 3. 容灾：停 etcd，重启 shop-server
docker stop gf_etcd
cd shop-server && go run .                             # 应带 snapshot 起来，configFrom=snapshot
docker start gf_etcd                                   # 后台 5s 重连，无需重启进程

# 4. 审计：历史与回滚
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9000/api/v1/configs/history/services/shop-server
```

发布链路的验证需要真实 Docker 与一个 `cc-*` 容器，见 [打包与发布](../01-getting-started/release-and-rollout.md) 的完整流程。

## CI

仓库目前**没有** CI 配置。最小可用的作业：

```yaml
# 只需 Go + 一个 job，测试完全离线
- uses: actions/setup-go@v5
  with: { go-version: '1.25' }
- run: go test ./pkg/etcdcfg/... ./configure-server/... ./shop-server/... ./deploy-agent/...
- run: go vet ./...
```

`configure-server/...` 与 `shop-server/...` 全量跑会带上 controller / logic 包，它们**不连 etcd**（见上面那条规则），所以 CI 里不需要起服务容器。前端另加 `npm ci && npm run build`（`tsc` 是构建的一部分，类型错误会挡下）。

## 相关文档

- [设计决策记录](design-decisions.md) —— `init()` → `cmd` 的完整论证
- [etcdcfg SDK](../02-reference/etcdcfg-sdk.md) —— 被测逻辑的行为定义
- [贡献指南](../../CONTRIBUTING.md)
