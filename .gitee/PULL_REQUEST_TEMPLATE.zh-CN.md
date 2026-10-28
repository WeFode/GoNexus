### 该 PR 解决的问题



### 类型

- [ ] 新功能
- [ ] Bug 修复
- [ ] 文档
- [ ] 重构（不改变外部行为）
- [ ] 破坏性变更

### 验证方式

<!-- 实际跑过什么。涉及发布链路（探针、docker 命令、任务状态机）时必须给真实环境的验证记录，CI 拦不住这部分。 -->

```bash
go test ./pkg/etcdcfg/... ./configure-server/... ./shop-server/... ./deploy-agent/...
go vet ./...
npm --prefix web run build
```

- [ ] 单元测试通过（**必须完全离线**，不应需要 etcd / Postgres / Docker）
- [ ] 手工验证过的链路：
- [ ] 测试环境：<!-- amd64 / arm64，PostgreSQL / 达梦 -->

### 影响面

- [ ] 改动 etcd key 布局或 `svc.etcd.*` 配置项
- [ ] 改动 `/api/v1` 已有接口的字段或语义
- [ ] 改动数据库表结构（pgsql 与 dm **两份脚本都要**，且需 `IF NOT EXISTS`）
- [ ] 改动 `pkg/etcdcfg`（影响所有已接入的微服务）
- [ ] 改动探针回写的英文 message 文案（需同步 `web/src/api/deploy.ts` 的 `parseJobSemantics`）

破坏性变更请在标题加 `BREAKING CHANGE:`，并在正文写清升级步骤。

### 文档

- [ ] 已同步更新 `docs/` 对应文档（见 CONTRIBUTING.md 的「改什么更新哪里」表）
- [ ] 已在 `CHANGELOG.md` 的 `Unreleased` 增加条目

### 检查清单

- [ ] `manifest/config/config.yaml` **没有**被提交（含 `jwtSecret` / 口令 / `agentToken`）
- [ ] 没有在 `init()` 或空白 import 里调用 `etcdcfg.Boot`
- [ ] 服务名在五处保持一致（`@` 后缀 / etcd key / 中台服务名 / `catalog.name` / `cc-` 容器名）
- [ ] 注释只写「为什么」，没有复述代码的注释
