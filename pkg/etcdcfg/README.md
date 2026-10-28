# etcdcfg

GoFrame 微服务接入配置中心的**唯一依赖**。本地文件只留 `svc.etcd.host`，其余 `server` / `database` / `redis` 由 etcd 的 `shared/*` + `services/<服务名>` 合并下发。

权威文档在 `docs/`，本文件只做入口，避免同一内容多处漂移。

| 你要做什么 | 看哪里 |
|------------|--------|
| 接入一个新服务 | [接入新微服务](../../docs/01-getting-started/integrate-a-service.md)，完整模板在 [examples/gf-service/](../../examples/gf-service/) |
| 了解行为与契约 | [etcdcfg SDK](../../docs/02-reference/etcdcfg-sdk.md) —— 合并算法、热重载边界、快照容灾、`loopbackAs`、探活契约 |
| 查配置项 | [配置项字典](../../docs/02-reference/configuration.md#pkgetcdcfg所有业务微服务) |
| 理解为什么这样设计 | [设计决策记录](../../docs/03-development/design-decisions.md) —— D-01 不做数据库双写、D-02 快照落磁盘、D-03 Watch 拆两个前缀、D-04 Boot 不进 `init()` |
| 改这个包 | [测试](../../docs/03-development/testing.md)、[贡献指南](../../CONTRIBUTING.md) |

## 最小接入

`internal/cmd/cmd.go`，必须在 `g.Server()` / `g.DB()` **之前**：

```go
if err = etcdcfg.Boot(ctx); err != nil {
    return err
}

s := g.Server()
s.Group("/api/v1", func(group *ghttp.RouterGroup) {
    group.Middleware(ghttp.MiddlewareHandlerResponse)
    etcdcfg.BindHealth(group) // GET /api/v1/health
    group.Bind(/* 业务 controller */)
})
```

业务代码继续 `g.Cfg().Get`，不必改。**不要放 `init()`**，否则 `go test` 会强行连 etcd。

## 测试

```bash
go test ./pkg/etcdcfg/...
```

全部离线，不需要 etcd。
