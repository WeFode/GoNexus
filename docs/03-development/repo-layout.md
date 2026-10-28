# 仓库结构与构建

## go.work 多模块

仓库根 `go.work`：

```
go 1.25.0

use (
	./configure-server
	./deploy-agent
	./pkg/etcdcfg
	./shop-server
)
```

四个模块的 `module` 路径：

| 目录 | module | 说明 |
|------|--------|------|
| `pkg/etcdcfg` | `configure-center/pkg/etcdcfg` | 共用 SDK，**版本 `v0.0.0`，靠 replace 引用** |
| `configure-server` | `configure-server` | 配置中心 :9000 |
| `shop-server` | `shop-server` | 示例微服务 :8000 |
| `deploy-agent` | `deploy-agent` | 节点探针，无 HTTP 服务 |

根目录还有两个**不在 go.work 里**的目录：

- `web/` —— 独立 npm 项目
- `examples/gf-service/` —— 只有 `config.yaml` 和 `README.md`，是复制模板，不是可编译模块

`deploy/` 存放打包契约（`catalog.json`、`runtime.Dockerfile`），产物落 `deploy/dist/`。

### 在工作区之外使用 SDK

独立仓库引用 SDK 时：

```
require configure-center/pkg/etcdcfg v0.0.0
replace configure-center/pkg/etcdcfg => ../configure-center/pkg/etcdcfg
```

`go.work.sum` 是工作区级校验和，提交它，但**不要**指望它在 CI 里稳定——各模块自己的 `go.sum` 才是权威。

## 顶层布局

```
configure-center/
├── pkg/etcdcfg/           SDK（10 个 .go + 6 个 _test.go）
├── configure-server/      配置中心
│   ├── api/               auth / config / deploy / health 的 v1 请求响应
│   ├── internal/
│   │   ├── boot/          authx.Init → pingAuditDB → NewClient → Seed
│   │   ├── cmd/           两组路由
│   │   ├── controller/    薄封装
│   │   ├── service/       IConfig / IDeploy 接口 + Register
│   │   ├── logic/         config / deploy 真正实现
│   │   ├── dao/ model/    gf gen 生成
│   │   ├── middleware/    CORS + JWT
│   │   └── packed/        gf pack 产物
│   ├── utility/           authx（JWT+bcrypt+锁定）/ etcdx（客户端单例）
│   ├── manifest/
│   │   ├── config/        config.yaml（gitignore）+ config.example.yaml
│   │   ├── etcd-seed/     shared/ services/
│   │   ├── sql/{pgsql,dm}/
│   │   └── deploy/kustomize/   GoFrame 脚手架自带的 k8s 样例，本项目未使用
│   ├── scripts/
│   │   ├── pg-init/00-init.sh   compose 首次初始化
│   │   └── etcd-rbac.sh         生产 etcd 权限
│   ├── Dockerfile         单模块构建（make image 用）
│   ├── docker-compose.yml       etcd + Postgres + Redis
│   └── docker-compose.app.yml   configure-server 容器（host 网络）
├── shop-server/           同构，业务示例
├── deploy-agent/          main.go + internal/{dockerx,hostmetrics}
├── web/                   Vite + React 控制台
├── deploy/
│   ├── catalog.json       打包契约
│   ├── runtime.Dockerfile FROM scratch
│   └── dist/              tar 产物（gitignore）
├── examples/gf-service/   复制模板
├── package.ps1 / package.sh
└── go.work
```

## 忽略规则

| 文件 | 排除内容 |
|------|----------|
| `.gitignore`（根） | `deploy/dist/*.tar`、`deploy/dist/*.json`，并 `!deploy/catalog.json` |
| `configure-server/.gitignore` | **`manifest/config/config.yaml`**（含密钥）、`data/`、`*.exe`、`bin/`、`temp/`、`*.log`、`.idea/`、`.vscode/` |
| `shop-server/.gitignore` | 同上 |
| `deploy-agent/.gitignore` | `manifest/config/config.yaml`、`data/`、`*.exe`、`*.log` |
| `web/.gitignore` | `node_modules`、`dist`、`*.log`、`*.local`、编辑器目录 |

**三个模块的本地 `config.yaml` 都不入库**，只提交 `config.example.yaml`。改示例配置等于改镜像里的默认引导配置，谨慎填值。

## Makefile

`configure-server/Makefile` 与 `shop-server/Makefile` 都 `include ./hack/hack-cli.mk` 和 `./hack/hack.mk`（GoFrame CLI 提供 `gf gen dao/ctrl/service`、`gf build`、`gf docker`）。

| 目标 | configure-server | shop-server |
|------|------------------|-------------|
| `make docker-up` | `docker compose up -d`（etcd/PG/Redis） | 委托到 `../configure-server` |
| `make docker-down` | `docker compose down` | 委托 |
| `make docker-logs` | `docker compose logs -f` | 委托 |
| `make run` | `go run .` | `go run .` |
| `make gen` | `gf gen ctrl && gf gen service` | `gf gen dao && gf gen ctrl && gf gen service` |
| `make image` | `docker build -f Dockerfile ..`（**上下文是仓库根**） | 同 |
| `make package` | `image` + `docker save` → `../deploy/dist/configure-server-image.tar` | → `shop-server-image.tar` |
| `make tidy` | `go mod tidy` | 同 |
| `make build` | `gf build`（见 hack/config.yaml） | 同 |
| `make help` | 列出以上 | 同 |

`IMAGE` 和 `DIST_TAR` 可用环境变量覆盖：`make package IMAGE=shop:v2 DIST_TAR=/tmp/s.tar`。

### `make package` 与 `package.ps1` 的区别

| | `make package` | 根目录 `package.ps1` / `package.sh` |
|--|--|--|
| Dockerfile | 各模块自己的 `Dockerfile` | `deploy/runtime.Dockerfile` |
| 产物名 | `<服务>-image.tar` | `<服务>-<平台>.tar` |
| 平台 | 跟随本机 docker | 显式 `--platform`，可交叉到 arm64 |
| 元数据 | 无 | 旁边写 `.json`（service/image/platform/containerPort/tar/sizeBytes/builtAt） |
| 适用 | 手工 scp + `docker compose up` | 中台「发布」页上传 |

**中台发布要用根目录脚本的产物名**，服务端按文件名里的 `linux-amd64` / `linux-arm64` 解析平台。

## 打包脚本内部

`package.ps1` / `package.sh` 对 `deploy/catalog.json` 里每个（或 `-Service` 指定的）服务：

```
1. 读 catalog：只取 name 和 containerPort
2. CGO_ENABLED=0 GOOS=linux GOARCH=<arch> go build -ldflags="-s -w" -o <stage>/main
   （在对应模块目录里跑，go.work 让 pkg/etcdcfg 自动参与）
3. cp <module>/manifest/config/config.example.yaml <stage>/config.yaml
4. 若 <module>/manifest/etcd-seed 存在则拷进 <stage>/seed
5. docker build --platform <plat> -f deploy/runtime.Dockerfile -t <svc>:<plat> <stage>
6. docker save -o deploy/dist/<svc>-<plat>.tar
7. 写 deploy/dist/<svc>-<plat>.json 元数据
```

参数：`-Platform`（默认 `linux/amd64`）、`-Service`、`-OutDir`（默认 `deploy/dist`）。

`runtime.Dockerfile`：

```dockerfile
FROM scratch
WORKDIR /app
COPY main /app/main
COPY config.yaml /app/manifest/config/config.yaml
COPY seed /app/manifest/etcd-seed
EXPOSE 8000
ENTRYPOINT ["/app/main"]
```

**`catalog.json` 的 `dockerfile` 字段两个脚本都不读取**——构建固定用 `deploy/runtime.Dockerfile`。字段留着是自文档化，改它不会改变打包行为。`EXPOSE 8000` 同理是注释性质，真实端口来自 `containerPort`。

`FROM scratch` 意味着镜像里没有 shell、没有 CA 根证书、没有时区数据。所以探针 `docker run` 时会挂 `/etc/ssl/certs`（宿主机存在时）并设 `TZ=Asia/Shanghai`。

## GoFrame CLI

`configure-server/hack/config.yaml` / `shop-server/hack/config.yaml` 配的是**开发期工具**，不进运行时：

```yaml
gfcli:
  gen:
    dao:
      - link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/config_center"
        descriptionTag: true
        tables: "config_history,deploy_nodes,deploy_artifacts,deploy_jobs"
        jsonCase: "Snake"
  build:
    name: "main"
    arch: "amd64"
    system: "linux"
    mod: "none"
    path: "./bin"
    packSrc: "manifest/config"
    extra: "-buildvcs=false"
```

三个要点：

- `gen.dao.link` 当前指向**达梦**。换 Postgres 环境生成 DAO 前先改成注释掉的那行 pgsql 串，否则实体标签带的是达梦列注释。
- `build.packSrc: manifest/config` 是 `internal/packed` 的来源——本地 yaml 被打进二进制。**但 `etcdcfg.Boot` 之后 `g.Cfg()` 已换成 Adapter，packed 里的内容只对「读 `svc.etcd.*` 这一步」有用。**
- `extra: -buildvcs=false` 是为了绕开 GoLand 用 Administrator 打开、仓库在别的用户目录下时 Git 返回 128 的问题。命令行同样遇到就在 `GOFLAGS` 里加。

`internal/packed` 是生成文件，不要手工编辑；`gf pack` 会覆盖。

## kustomize 目录

`configure-server/manifest/deploy/kustomize/` 和 `shop-server/` 下同名目录是 GoFrame 项目脚手架自带的 k8s 样例（base deployment/service + develop overlay）。**本项目的部署路径是「中台 + deploy-agent + docker」，没有用到这些清单**。留着不碍事，但别误以为它是推荐的上线方式。

## 提交约定

见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。当前历史只有三个提交、没有 tag，`CHANGELOG.md` 从 `Unreleased` 开始维护。

## 已知待办（欢迎 PR）

整理文档时发现的仓库卫生问题，都不是设计缺陷，改起来很小：

- `configure-server/main.exe~`、`shop-server/main.exe~` 是 GoFrame 构建残留，**已被提交进仓库**（工作区已删除但未提交）。`*.exe~` 应加进各模块 `.gitignore`。
- `configure-server/manifest/sql/{pgsql,dm}/004_auth_users.sql` 与 `deploy-agent/internal/dockerx/health.go` 目前**未纳入版本控制**，但代码已经依赖它们。缺 004 的环境登录会静默回退到 `auth.users` 静态账户，值得单独提交。
- `deploy-agent/deploy-agent-linux` 编译产物在仓库里且未被忽略。
- `deploy/catalog.json` 的 `dockerfile` 字段无人读取，要么让脚本真正使用它（支持每服务自定义 Dockerfile），要么删掉。
- 配置中心的 `/api.json` 不经过 JWT 路由，`deploy` 接口的字段结构公开可读。没有敏感数据，但对外网部署时建议在反向代理上关掉。
