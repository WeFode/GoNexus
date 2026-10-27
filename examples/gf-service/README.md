# 新 GoFrame 服务接入配置中心

把下面三个文件抄进你的微服务，服务名全局一致：`svc.etcd.host` 的 `@` 后缀 = etcd `services/<名>` = `deploy/catalog.json` 的 `name` = 容器 `cc-<名>`。

业务逻辑继续 `g.Cfg().MustGet` / `g.DB()` / `g.Redis()`，**不用改**。

## 1. `manifest/config/config.yaml`

```yaml
# 只留 etcd 入口。server / database / redis / logger 由配置中心下发。
svc:
  etcd:
    host: "127.0.0.1:2379@your-service"
    watch: true
    snapshotDir: "data/config-cache"
```

生产可加 `username` / `password`（etcd 只读账号，见 `configure-server/scripts/etcd-rbac.sh`）。

## 2. `go.mod`

```
require configure-center/pkg/etcdcfg v0.0.0

replace configure-center/pkg/etcdcfg => ../configure-center/pkg/etcdcfg
```

路径按你仓库相对位置改。同一 `go.work` 多模块时 replace 写成 `../pkg/etcdcfg`。

## 3. `internal/cmd/cmd.go`（节选）

必须在 `g.Server()` 之前调用 `etcdcfg.Boot`。不要放 `init()`。

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

启动后访问 `GET /api/v1/health`，`configFrom` 为 `etcd` 即接入成功。

## 4. 在配置中心登记

中台「服务配置 → 新建」，key 填 `your-service`，YAML 至少包含本服务的 `server.address`。公共 `database` / `redis` 放「公共配置」，本服务只需覆盖差异项。

也可以把文件放到配置中心仓库：

`configure-server/manifest/etcd-seed/services/your-service.yaml`

## 5. 一键打包（可选）

根目录 `deploy/catalog.json` 增加一条，然后 `.\package.ps1 -Service your-service`。容器名固定 `cc-your-service`。
