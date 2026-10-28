# 新 GoFrame 服务接入配置中心

复制模板目录：`config.yaml` 直接拷走，下面三段代码贴进你的服务即可。

行为与契约的权威说明在 [接入新微服务](../../docs/01-getting-started/integrate-a-service.md) 和 [etcdcfg SDK](../../docs/02-reference/etcdcfg-sdk.md)；这里只留复制用的片段。

**服务名五处必须一致**：`svc.etcd.host` 的 `@` 后缀 = etcd `services/<名>` = 中台服务 key = `deploy/catalog.json` 的 `name` = 容器 `cc-<名>`。

## 1. `manifest/config/config.yaml`

见本目录 [`config.yaml`](config.yaml)。把 `your-service` 换成真实服务名，`server` / `database` / `redis` / `logger` 全部不要写在这里。

## 2. `go.mod`

```
require configure-center/pkg/etcdcfg v0.0.0

replace configure-center/pkg/etcdcfg => ../pkg/etcdcfg
```

独立仓库把路径指到本仓库的 `pkg/etcdcfg`。同一 `go.work` 多模块时写 `../pkg/etcdcfg`。

## 3. `internal/cmd/cmd.go`

**必须在 `g.Server()` 之前调用 `etcdcfg.Boot`。不要放 `init()`**，否则 `go test` 会强行连 etcd。

```go
package cmd

import (
	"context"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"
)

var Main = gcmd.Command{
	Name: "main",
	Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
		if err = etcdcfg.Boot(ctx); err != nil {
			return err
		}

		s := g.Server()
		s.Group("/api/v1", func(group *ghttp.RouterGroup) {
			group.Middleware(ghttp.MiddlewareHandlerResponse)
			etcdcfg.BindHealth(group)
			group.Bind(/* 你的业务 controller */)
		})
		s.Run()
		return nil
	},
}
```

参考实现：`shop-server/internal/cmd/cmd.go`。

## 4. 在配置中心登记

中台「服务配置 → 新建」，key 填 `your-service`，YAML 至少包含本服务的 `server.address`。公共 `database` / `redis` 放「公共配置」，本服务只覆盖差异项。

或者把文件放进配置中心仓库，启动时自动 seed：

```
configure-server/manifest/etcd-seed/services/your-service.yaml
```

## 5. 验证

```bash
curl -sS http://127.0.0.1:<port>/api/v1/health
```

`configFrom` 为 `etcd` 即接入成功（`snapshot` 表示 etcd 没连上、用了磁盘快照）。

## 6. 一键打包（可选）

根目录 `deploy/catalog.json` 加一条，然后 `.\package.ps1 -Service your-service`。容器名固定 `cc-your-service`。

> `dockerfile` 字段目前不参与打包，两个脚本都固定用 `deploy/runtime.Dockerfile`；只有 `name` 和 `containerPort` 被读取。

## 生产：etcd 只读账号

开启 etcd RBAC 后在 `config.yaml` 补 `username` / `password`，脚本见 `configure-server/scripts/etcd-rbac.sh`。SDK 的 Watch 拆成「shared 前缀 + 本服务精确 key」正是为了支持最小授权。
