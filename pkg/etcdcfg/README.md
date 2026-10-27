# etcdcfg

GoFrame 微服务接入配置中心的**唯一依赖**。本地文件只留 `svc.etcd.host`，其余 `server` / `database` / `redis` 由 etcd `shared/*` + `services/<服务名>` 合并下发。

## 最小接入（三行）

本地 `manifest/config/config.yaml`：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@your-service"   # 与 etcd 服务 key、打包 catalog.name 相同
    watch: true
    snapshotDir: "data/config-cache"
    # loopbackAs: "host.docker.internal"  # 仅容器内部署时由 Agent 写入
    stickyKeys: []
```

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

业务代码继续 `g.Cfg().Get`，不必改。不要放 `init()`，否则 `go test` 会强行连 etcd。

`go.mod`：

```
require configure-center/pkg/etcdcfg v0.0.0
replace configure-center/pkg/etcdcfg => ../pkg/etcdcfg
```

独立仓库把 replace 指到本仓库的 `pkg/etcdcfg` 即可。

然后：中台「服务配置」新建同名 YAML，或放到 `configure-server/manifest/etcd-seed/services/<名>.yaml`。需要一键打包时再改 `deploy/catalog.json`。

完整可复制文件见仓库 `examples/gf-service/`。

## 行为

- 启动拉 **shared + 本服务** 合并 YAML，原子写入 `data/config-cache/<service>.snapshot.yaml`
- etcd 不可用且快照存在则用快照启动（health `degraded`），后台重连
- Watch 只盯 `shared/` 前缀和本服务精确 key（可配 etcd 只读账号）
- `GET /api/v1/health`：etcd + 配置来源；合并配置里有 `database` / `redis` 才探测

## API

| 函数 | 说明 |
|------|------|
| `Boot(ctx)` | 读本地 `svc.etcd.*`，切换 `g.Cfg()` |
| `BootFromLocal(ctx)` | 同 Boot，返回 `*Adapter` |
| `BindHealth(group)` | 注册 `GET /health` |
| `Probe(ctx)` | 自定义探活时复用同一套结果 |
| `Current()` / `Runtime()` | 取 Adapter / 热更新状态 |
