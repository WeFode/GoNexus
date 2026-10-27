# 贡献指南

感谢参与。开始之前请先读 [文档索引](./docs/README.md)，尤其是 [架构与实现链路](./docs/02-reference/architecture.md) 的「设计边界」一节——这个项目的大部分坑都源于越过了那几条边界。

## 环境

| 工具 | 要求 |
|------|------|
| Go | 1.25+（`go.work` 声明 `go 1.25.0`） |
| Docker | 带 compose v2 |
| Node.js | Vite 7 要求的较新 LTS |
| make | 各模块的 Makefile |
| PowerShell 或 bash | 根目录打包脚本 |

```bash
git clone https://gitee.com/lin_30_0/configure-center.git
cd configure-center

cd configure-server
make docker-up        # etcd + Postgres + Redis
make run              # :9000

cd ../shop-server && make run      # :8000
cd ../web && npm install && npm run dev   # :5173
```

完整步骤与验证方式见 [快速开始](./docs/01-getting-started/quickstart.md)。

## 提交前必做的三件事

```bash
# 1. 测试（完全离线，约 1 秒）
go test ./pkg/etcdcfg/... ./configure-server/... ./shop-server/... ./deploy-agent/...

# 2. 静态检查
go vet ./...

# 3. 前端类型检查（npm run build 已包含 tsc）
npm --prefix web run build
```

测试**不应该**需要 etcd、数据库、Redis 或 Docker。如果你的改动让某个测试开始联网，说明破坏了下面的第一条规范。

## 代码规范

### Go

标准 `gofmt` + `go vet` 干净即可。项目特有约束：

- **不要在 `init()` 里连 etcd。** `etcdcfg.Boot(ctx)` 必须在 `cmd.Main.Func` 函数体最前面显式调用，且早于第一次 `g.Server()` / `g.DB()` / `g.Redis()`。这是硬性规则，理由见 [D-04](./docs/03-development/design-decisions.md#d-04-boot-为什么从-init-搬到-cmd)。
- **分层不要越过。** `api/` 只放请求响应结构 + `g.Meta`；`controller/` 只做校验和从 ctx 取鉴权信息；`service/` 是接口定义与注册；`logic/` 是实现。controller 不直接碰 etcd 或数据库。
- **写接口忽略请求体的 `operator`。** 一律用 `ctx` 里的 JWT 登录名，防止伪造审计。
- **`g.Cfg()` 的读法决定热更新是否可见。** 希望配置能热改的地方，每次使用时读；启动时建好连接池的东西（DSN、监听端口）不会因为 etcd 改了值而变化。
- **注释只写「为什么」。** 已有的注释都是约束说明或规避特定 bug 的记录，没有复述代码内容的注释。新增注释同理。

### 前端

- 走 `src/api/client.ts` 的 `request()`，不要自己 `fetch`——否则丢掉响应包解析和 401 跳登录。
- 上传用 `FormData`，**不要手动设 `Content-Type`**（boundary 得留给浏览器）。
- 新增页面：`pages/` 组件 → `App.tsx` 在 `<AdminLayout>` 下加子路由 → `layouts/AdminLayout.tsx` 注册菜单项。
- `onboard/snippets.ts` 里的接入代码片段要与 [接入新微服务](./docs/01-getting-started/integrate-a-service.md) 保持一致。
- `api/deploy.ts` 的 `parseJobSemantics` 依赖探针回写的英文 message 字面量（`health ok`、`rolled back`、`no previous version`）。**改探针文案要同步改这里。**

### 命名一致性

服务名在**五个地方必须完全相同**，加新服务或改名时逐个核对：

```
svc.etcd.host 的 @ 后缀  ==  etcd <prefix>/services/<名>
                     ==  中台「服务配置」key  ==  deploy/catalog.json 的 name
                     ==  容器名 cc-<名>
```

## 不要提交的东西

| 路径 | 原因 |
|------|------|
| `*/manifest/config/config.yaml` | **含 `jwtSecret`、账户口令、`agentToken`、本机 DSN**。三个模块的 `.gitignore` 已排除，只提交 `config.example.yaml` |
| `deploy/dist/` 下的 `.tar` / `.json` | 构建产物 |
| `web/node_modules`、`web/dist` | 已在 `web/.gitignore` |
| `*/data/` | 快照、artifacts、实例配置 |
| `*.exe`、`bin/`、`temp/`、`*.log` | 构建与运行产物 |

`config.example.yaml` 是会被烤进 `FROM scratch` 镜像的默认引导配置，**只能是占位值**。往里写真实口令等于把口令发布到仓库。

## GoFrame CLI 生成物

`internal/dao`、`internal/model/{do,entity}`、`internal/packed` 由 CLI 生成，不要手工编辑。

```bash
cd configure-server && make gen     # gf gen ctrl && gf gen service
cd shop-server      && make gen     # gf gen dao && gf gen ctrl && gf gen service
```

`hack/config.yaml` 的 `gen.dao.link` 当前指向达梦。用 Postgres 环境生成前先改成 pgsql 串，否则实体的列注释来自达梦。

## 数据库变更

**不要在 Go 代码里建表。** 配置中心进程只探测 `config_history` 是否可读，不执行 DDL。

改表结构时：

1. 写进 `configure-server/manifest/sql/pgsql/`，**并在 `dm/` 写一份对齐的**（达梦用双引号小写保持同名，GoFrame ORM 才能不改代码切换两边）。
2. 用 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`，让已有库能重复执行补表。
3. 同步更新 [数据库表结构](./docs/02-reference/database-schema.md) 和 `internal/dao` 生成配置。

## 测试

给**纯逻辑**加测试，不要 mock 外部系统：

| 改动位置 | 测试放哪 |
|----------|----------|
| 合并 / sticky / diff / loopback | `pkg/etcdcfg/*_test.go` |
| 平台匹配、容器名、节点推荐打分 | `configure-server/internal/logic/deploy/*_test.go` |
| 历史 BASELINE 判定 | `configure-server/internal/logic/config/history_test.go` |
| docker / proc 输出解析 | `deploy-agent/internal/*_test.go` |

模式：把解析和计算留在纯函数里，把「执行 docker」「读写 etcd」放薄壳，**测试打纯函数那一层**。现有测试没有用 mock 框架，也不要引入——需要 mock etcd 客户端才能测，通常说明该把逻辑抽成纯函数。

必保的不变量（现有测试已覆盖，改坏会被拦住）：

- 资源数据缺失记为「未上报」，**不能当成 0% 空闲**
- `PutIfAbsent` 不覆盖 etcd 已有 key
- `stickyKeys` 为空时全部热重载
- 快照文件名固定，内容是不含 sticky 处理的完整合并结果

## 文档

代码和规范变了，**文档要同 PR 更新**。这个项目的大部分价值在于把「为什么这样设计」写清楚了。

| 改了什么 | 更新哪里 |
|----------|----------|
| SDK 行为 / 配置项 | `docs/02-reference/etcdcfg-sdk.md`、`docs/02-reference/configuration.md` |
| HTTP 接口 | `docs/02-reference/api.md` |
| 表结构 | `docs/02-reference/database-schema.md` |
| 探针协议 / docker 行为 | `docs/02-reference/deploy-agent.md` |
| 前端页面与交互 | `docs/02-reference/web-console.md` |
| 接入 / 发布 / 离线部署的操作步骤 | `docs/01-getting-started/` 里对应那篇，外加 `docs/01-getting-started/troubleshooting.md` |
| 新增能力或破坏性变更 | `CHANGELOG.md` 的 `Unreleased` |
| 推翻或修正一个既有取舍 | `docs/03-development/design-decisions.md` 新开一条 D-XX |

写文档时区分**「仓库里存在的」和「实际生效的」**——例如 `deploy/catalog.json` 的 `dockerfile` 字段并不参与打包，这类事实要说清楚，不要照抄字段名猜功能。

## 提交与 Pull Request

远端在 **Gitee**（`https://gitee.com/lin_30_0/configure-center`），GitHub 镜像另说。

### 分支与提交

```bash
git checkout -b feat/<简短主题>      # fix/ docs/ refactor/ 同理
```

提交信息用**英文、祈使句、首字母大写、结尾不加句号**，一句话说清做了什么：

```
Enhance deployment capabilities with node resource metrics and recommendations
Add support for DM database and enhance deployment features
```

改动较大时正文可以分段说明动机与影响面。参考 `git log` 现有风格。

一个 PR 做一件事。文档 + 代码 + CHANGELOG 属于同一件事，放同一个 PR。

### PR 描述

用 `.github/PULL_REQUEST_TEMPLATE.md`（GitHub）或 `.gitee/` 下的模板（Gitee）。Gitee 和 GitHub 的模板机制不同，两套都保留了；在 Gitee 上提 PR 时按 `.gitee/PULL_REQUEST_TEMPLATE.zh-CN.md` 的段落手工填写即可。

必须说明的三点：

1. **验证方式** —— 跑了哪些测试、手工验过什么链路、用的什么环境（Postgres 还是达梦、amd64 还是 arm64）
2. **影响面** —— 是否改动表结构、是否影响已有 etcd 配置、是否需要迁移
3. **是否更新了文档**

破坏性变更请在标题加 `BREAKING CHANGE:`，并在正文说明升级步骤。

### 评审

- 至少一位维护者 approve
- `go test`、`go vet`、`npm run build` 全绿
- 涉及发布链路（探针、docker 命令、任务状态机）的改动，需要提交者提供**真实环境的验证记录**——这部分没有集成测试，CI 拦不住

## 行为准则

[贡献者公约 2.1](./CODE_OF_CONDUCT.md)。项目地址 <https://gitee.com/lin_30_0/configure-center>。

发现安全问题请按 [SECURITY.md](./SECURITY.md) 私密报告，不要开公开 Issue。

## 新手起步

`docs/03-development/repo-layout.md` 末尾列了一份「已知待办」，都是改动很小、不需要上下文就能上手的仓库卫生问题，适合作为第一个 PR。

改之前先开 Issue 说一句，避免撞车。
