# 接入新微服务

任意 GoFrame HTTP 服务接入配置中心只需要三样东西：**依赖 `pkg/etcdcfg`** + **本地一行 etcd 入口** + **`cmd` 里调一次 `Boot`**。业务代码继续用 `g.Cfg().Get` / `g.DB()` / `g.Redis()`，不用改。

本文与仓库里的复制模板 [examples/gf-service/](../../examples/gf-service/) 内容一致；模板目录只有 `config.yaml`，`cmd.go` 片段在模板 README 正文里。

SDK 的行为细节（合并算法、防抖、快照、探活）见 [etcdcfg SDK](../02-reference/etcdcfg-sdk.md)。

## 0. 先定死服务名

服务名必须在**四个地方完全相同**，这是接入唯一的强约束：

```
svc.etcd.host 的 @ 后缀  ==  etcd key /config-center/services/<名>
                     ==  中台「服务配置」的 key  ==  deploy/catalog.json 的 name
                     ==  容器名 cc-<名>（旁路灰度 cc-<名>-canary）
```

名字对不上时，服务能连上 etcd 但读不到自己的配置，表现是启动时合并结果里没有 `server.address`。

## 1. 本地配置只留 etcd 入口

`<你的服务>/manifest/config/config.yaml`：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@your-service"
    watch: true
    snapshotDir: "data/config-cache"
```

`server` / `database` / `redis` / `logger` 这些**全部删掉**，由配置中心下发。可用字段见 [配置项字典](../02-reference/configuration.md)。

## 2. 加依赖

```
require configure-center/pkg/etcdcfg v0.0.0

replace configure-center/pkg/etcdcfg => ../pkg/etcdcfg
```

同一 `go.work` 多模块时，replace 指向仓库内相对路径即可。独立仓库把 replace 指到本仓库的 `pkg/etcdcfg` 绝对路径，或发布后直接 `go get`。

## 3. 在 `cmd` 里 Boot

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
		// 必须在第一次 g.Server() / g.DB() / g.Redis() 之前
		if err = etcdcfg.Boot(ctx); err != nil {
			return err
		}

		s := g.Server()
		s.Group("/api/v1", func(group *ghttp.RouterGroup) {
			group.Middleware(ghttp.MiddlewareHandlerResponse)
			etcdcfg.BindHealth(group) // GET /api/v1/health
			group.Bind(/* 你的业务 controller */)
		})
		s.Run()
		return nil
	},
}
```

两条硬规则：

- **不要放进 `init()`，也不要在 `main.go` 空白 import。** `init()` 里的 Boot 会让 `go test` 强行联网连 etcd，断网时单测直接挂；而且 `init()` 里失败只能 `log.Fatalf` 硬杀进程，搬进 `cmd` 才能 `return err` 优雅退出。理由见 [设计决策记录](../03-development/design-decisions.md)。
- **必须在 `g.Server()` 之前。** 监听端口、DB 连接池、Redis 客户端都在第一次使用时按当时的内存配置建立，Boot 晚于它们等于没生效。

`Boot` 与 `BootFromLocal` 的区别：后者额外返回 `*Adapter`，只在你需要自定义探活逻辑时才用。

## 4. 在配置中心登记服务

两种方式，任选：

**中台页面**：「服务配置 → 新建」，key 填 `your-service`，YAML 至少要有本服务的 `server.address`。

**seed 文件**（推荐，可版本化）：把 YAML 放到

```
configure-server/manifest/etcd-seed/services/your-service.yaml
```

配置中心启动时会自动 `PutIfAbsent`；已经跑着的实例调 `POST /api/v1/configs/seed` 灌入。

公共项（数据库、Redis）放「公共配置」/`shared/`，服务配置只写差异项——`shared/*` 先深层合并，再由 `services/<名>` 覆盖同名 key。

登记之后不用回来翻文档：中台「服务配置」页的「接入指引」（页头按钮，或卡片「更多 → 接入代码」）会给出与本文 §1 / §2 / §3 一致的三段可复制代码。

![接入指引抽屉（截图为 mock 数据，服务名 your-service 是占位）](../assets/screenshots/onboard.png)

## 5. 验证

```bash
curl -sS http://127.0.0.1:<port>/api/v1/health
```

`etcdcfg.BindHealth` 注册的探活返回里：

| 字段 | 期望 |
|------|------|
| `configFrom` | `etcd`（`snapshot` 表示 etcd 没连上、用了磁盘快照，此时状态 `degraded`） |
| `database` / `redis` | 合并配置里有对应根 key 才探测；没有则 `skipped` |

再改一个业务配置项，确认不重启就能读到新值——参照 [快速开始](quickstart.md) 第 4 步。

## 6. 纳入一键打包（可选）

只有需要通过中台发布镜像时才做。编辑根目录 `deploy/catalog.json`：

```json
{
  "services": [
    { "name": "your-service", "dockerfile": "your-service/Dockerfile", "containerPort": 8080 }
  ]
}
```

`.\package.ps1 -Service your-service` 出 tar。

> 三个字段里 **只有 `name` 和 `containerPort` 被真正读取**。`package.ps1` 和 `package.sh` 都固定用 `deploy/runtime.Dockerfile` 构建，`dockerfile` 字段目前不参与打包流程，写上只是为了自文档化。详见 [仓库结构与构建](../03-development/repo-layout.md)。

## 7. 生产：etcd 只读账号

开启 etcd RBAC 后，在第 1 步的配置里补上账号密码：

```yaml
svc:
  etcd:
    host: "127.0.0.1:2379@your-service"
    username: "your-service"
    password: "<只读口令>"
```

SDK 的 Watch 故意拆成「`shared/` 前缀 + 本服务精确 key」两个 watcher，就是为了能给单个服务授最小权限——只读这两条路径，读不到别人的配置，也写不动任何 key。脚本见 `configure-server/scripts/etcd-rbac.sh`，权限设计见 [设计决策记录](../03-development/design-decisions.md)。

## 接入检查清单

- [ ] `@` 后缀、etcd 服务 key、中台服务名、`catalog.name`、容器名五处同名
- [ ] 本地 `config.yaml` 只剩 `svc.etcd.*`
- [ ] `etcdcfg.Boot` 在 `cmd` 函数体最前，且不在 `init()` / 空白 import 里
- [ ] `g.Server()` / `g.DB()` / `g.Redis()` 首次使用都在 Boot 之后
- [ ] 绑定了 `etcdcfg.BindHealth`
- [ ] `snapshotDir` 在容器部署时挂在持久卷上（etcd 故障时靠它冷启动）
- [ ] 换 DSN 或改监听端口时，走了滚动重启而不是指望热更新
