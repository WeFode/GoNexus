# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **当前状态：尚未发布任何版本，仓库没有 git tag。**
> 下面 `Unreleased` 汇总的是 `master` 上已实现但未打 tag 的全部能力，按三次提交的实际内容整理。第一次对外发布建议打 `0.1.0`，见文末的版本约定。

## [Unreleased]

### Added

**配置中心**

- 基于 etcd 的配置真相源：`/config-center/shared/*` 公共配置 + `/config-center/services/<服务名>` 服务专属配置，深层合并后由服务配置覆盖同名项
- `pkg/etcdcfg` —— GoFrame 微服务接入的唯一依赖，实现 `gcfg.Adapter`，业务代码继续 `g.Cfg().Get` 不用改
- **热更新**：etcd Watch → 150ms 防抖合并 → 只替换内存快照，不重启进程、不重绑端口、不重建连接池
- `stickyKeys` —— 指定不参与热重载的根 key；不配置则全部热重载
- **磁盘快照容灾**：合并 YAML 原子覆写 `data/config-cache/<服务>.snapshot.yaml`，etcd 不可用时降级启动（状态 `degraded`），后台每 5s 重连
- `svc.etcd.loopbackAs` —— 递归改写合并结果里的 `127.0.0.1`，让容器能访问宿主机的 etcd / Postgres / Redis
- 标准探活 `etcdcfg.BindHealth` —— `GET /api/v1/health` 返回 `configFrom`、`database`、`redis`；`database` / `redis` 只在合并配置里有对应根 key 时才探测
- 配置审计历史 `config_history`：`CREATE` / `UPDATE` / `BASELINE` / `DELETE` / `ROLLBACK`，首次修改前自动补录变更前快照
- **配置回滚** `POST /api/v1/configs/rollback`：从历史读目标版本再走一次 etcd Put，追加新版本号（回滚是一次新发布，不是时光倒流）
- 启动 seed：扫描 `manifest/etcd-seed/` 以 `PutIfAbsent` 写入 etcd，已存在不覆盖；`POST /api/v1/configs/seed` 支持 `force` 覆盖（需 `role=admin`）
- 合并预览 `GET /configs/preview/{name}`，与微服务启动时同一套 `deepMerge`
- JWT 登录 + bcrypt 账户 + 连续失败 5 次锁定 10 分钟；`operator` 取自 JWT 登录名，请求体不可伪造

**达梦 DM8（信创）**

- 审计库支持达梦：`manifest/sql/dm/` 与 `manifest/sql/pgsql/` 表名列名对齐，切换只改 `database.default.link`，代码不用动
- `main.go` 同时注册 pgsql 与 dm 驱动

**镜像发布**

- `package.ps1` / `package.sh` 交叉编译 + `FROM scratch` 构建 + `docker save` 出 tar，产物带 `.json` 元数据
- `deploy-agent` 节点探针：心跳领任务、`docker load` / `run` / `start` / `stop` / `restart` / `rm -f`，**不需要 SSH**
- 发布策略：全量、多节点灰度（前 N 台 `pending`，其余 `waiting`）、单节点旁路灰度（`cc-<服务>-canary` 不替换主容器）
- `POST /deploys/promote` 推进灰度：`waiting` → `pending`，或把成功的旁路 canary 转正并清理
- 镜像回滚 `POST /deploys/rollback`：取该节点该服务上一成功产物重新发布
- 容器生命周期操作 `POST /deploys/lifecycle`
- **发布后健康探测与自动回滚**：TCP + HTTP（默认 `/api/v1/health`，状态码 <500 视为健康），超时默认 90s；失败自动用旧镜像重新拉起
- 端口冲突诊断：`docker run` 失败时用 `netstat -ano` / `ss -lptn` / `lsof -i` 定位占用进程，结论写进任务说明
- **节点资源指标**：探针采集整机 CPU 占用、已用内存、已发布宿主机端口与 `cc-*` 容器的 `docker stats`；未上报记为缺失而非 0%
- **节点推荐** `GET /api/v1/nodes/recommend`：按剩余内存（权重 0.6）与 CPU（权重 0.4）打分，给出每台节点的合格性与原因，推荐结果不自动部署

**中台前端**

- Vite 7 + React 19 + shadcn/ui（Radix）+ Tailwind 4 控制台：概览 / 公共配置 / 服务配置 / 节点 / 发布 / 可观测 / 服务日志
- 中性灰阶设计系统与亮暗双主题：语义化 token 集中在 `web/src/index.css`，顶栏一键切换并记忆偏好
- YAML 编辑器、配置合并预览、历史对比抽屉、回滚操作
- 节点推荐面板、GoFrame 接入指引抽屉（内置可复制代码片段）
- 登录态守卫、401 自动跳登录、发布任务数徽标；后端短暂不可用时保留凭据并给出重试入口
- 统一加载骨架、空态、确认对话框与 toast，发布/日志控制台抽取共用逻辑

**内网离线部署**

- Linux ARM64 无镜像仓库环境的完整部署路径：打包机 `docker save` → 拷贝 → `docker load` → compose `--pull never`
- 探针以二进制 + systemd 托管（不放容器，避免 cgroup 读数失真和挂载路径错配）
- nginx 托管前端静态文件并反代 `/api`

**库表**

- `config_history`、`deploy_nodes`、`deploy_artifacts`、`deploy_jobs`（`001_schema.sql`）
- 节点指标列 `cpu_used_percent` / `memory_used_bytes` / `memory_source` / `host_ports`（`003_node_metrics.sql`，可对已有库重复执行）
- `auth_users` 登录账户表（`004_auth_users.sql`，bcrypt 哈希；表为空时用 `auth.users` 初始化）
- 库表脚本从 Go 代码移出，**配置中心进程不再执行 DDL**

**测试**

- 33 个离线单元测试，覆盖合并 / sticky / diff / loopback / 快照原子写 / 平台归一 / 容器名 / 节点推荐打分 / 历史 BASELINE 判定 / docker 与 proc 输出解析（`pkg/etcdcfg`、`configure-server/internal/logic`、`deploy-agent/internal`）

**文档与仓库治理**

- `docs/` 三档结构：使用文档（`01-getting-started`）、技术文档（`02-reference`）、开发文档（`03-development`），索引见 [docs/README.md](./docs/README.md)
- 设计决策记录 `docs/03-development/design-decisions.md`，含对早期 `config_info` 双写方案的推翻说明
- MIT `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`
- `.github/` 与 `.gitee/` 两套 Issue / PR 模板（远端为 Gitee，GitHub 镜像另用 `.github/`）
- `docs/assets/screenshots/` 11 张中台界面截图，根 `README.md` 放四张导览，逐页说明见 [中台前端 · 界面一览](./docs/02-reference/web-console.md#界面一览)。截图由本地 mock 后端渲染，服务名、节点、镜像与时间均为虚构数据

### Changed

- 根 `README.md` 精简为项目入口与导航，实现细节迁至 `docs/02-reference/`
- 原 `IMPLEMENTATION.md` 拆分后删除：运行时拓扑与链路 → `architecture.md`，接口清单 → `api.md`，内网离线部署 → `deploy-offline-arm64.md`，FAQ → `troubleshooting.md`
- 原 `optimize.md` 改写为设计决策记录后删除，其中 `config_info` 当前值表与「先落库再推 etcd」的事务方案**未被采用**，实际实现是 etcd 先写、审计后写且审计失败不回滚 etcd
- `pkg/etcdcfg` / `examples/gf-service` / `web` / `manifest/sql` 的模块内 README 改为指向 `docs/` 的短入口，避免同一内容多处漂移

### 尚未提供

- **API Gateway 与流量灰度**。发布页的「灰度」是**发布编排**（新镜像先在哪台机器、哪个端口跑起来），不是用户无感的流量切分。白名单/比例分流需要独立的网关服务读配置中心的 etcd 路由配置来做，业务服务不会自己把流量分给另一份自己。
- **gRPC 配置通道**。当前微服务直连 etcd，配置中心不在热更新数据面上。若要统一推送或强鉴权审计可另加一层，但不是接入前提。
- **CI 与集成测试**。单元测试全部离线；etcd 交互、docker 执行、发布链路只有手工验证清单，见 [测试](./docs/03-development/testing.md#端到端怎么验)。
- **细粒度权限**。只有 `admin` / `operator` 两档角色加 `agent` 令牌，没有按服务或按节点的授权。
- **配置内容加密**。etcd 里的 YAML 是明文，靠 RBAC 限制可读范围。
- **每节点独立 Agent 令牌**。当前是全局单一共享令牌，见 [SECURITY.md](./SECURITY.md)。

## 版本约定

首次对外发布时建议：

```bash
git tag -a v0.1.0 -m "configure-center 0.1.0"
```

- **`0.x`**：接口与 etcd key 布局可能变动，升级前读 CHANGELOG 的影响面。
- **`1.0.0`** 的门槛：`pkg/etcdcfg` 的 `Options` 字段、etcd key 布局、`/api/v1` 路由稳定，且有 CI 覆盖端到端发布链路。
- 破坏性变更在提交与 PR 标题标 `BREAKING CHANGE:`，并在 CHANGELOG 新增 `Removed` / `Migration` 小节说明升级步骤。

[Unreleased]: https://gitee.com/lin_30_0/configure-center
