# 设计决策记录

记录**为什么这样设计**，以及哪些早期设想已经被实现推翻。每篇给出背景、决定、后果和被否掉的方案。

用法层面的说明在 [技术文档](../02-reference/architecture.md)，这里只讲取舍。

---

## D-01 运行时配置只放 etcd，不做数据库双写

**状态**：已采纳（并推翻了最初的方案）

### 背景

参考 Nacos / Apollo 的常见做法是两张表：`config_info` 存当前生效值、`config_history` 存历史，推送时以库为准。早期的设计问答底稿里，最初的提案就是这个形状。

### 决定

**etcd 是运行时配置的唯一真相源。没有 `config_info` 表。**

Postgres 只承担三件事：配置审计历史（`config_history`）、部署编排（`deploy_nodes` / `deploy_artifacts` / `deploy_jobs`）、登录账户（`auth_users`）。

### 后果

- 微服务**直连 etcd**，configure-server 不在热更新的数据面上。配置中心进程挂了，已下发的配置照常读取和热更新。
- Postgres 挂了，配置读写完全正常，只有历史/发布/登录接口报错。启动时 `pingAuditDB` 因此只打 warning，不阻塞进程。
- 写入顺序是 **etcd 先、审计后**，且审计写失败**不回滚 etcd**（`logic/config.putConfig`）。这会产生「etcd 有新值但历史缺一条」的小窗口，换来的是「审计库故障不会让配置改不动」。
- 预览接口 `GET /configs/preview/{name}` 必须复用微服务同一套 `LoadMergedYAML`，否则「看到的」和「生效的」会分叉。现在确实是同一套代码。

### 被否掉的方案

`config_info` 双写。否掉的理由：

1. **两份真相必然漂移。** etcd 写了、库写失败（或反过来），运维要判断哪份是对的——这个成本比省下的那张表大得多。
2. **微服务不该依赖数据库才能知道配置是什么。** 见 D-02 的鸡生蛋论证。
3. 热更新靠的是 etcd Watch；就算库里有当前值，微服务也不会去读它，那张表只能服务中台页面——而中台页面本来就在读 etcd。

---

## D-02 容灾快照落本地磁盘，不落数据库

**状态**：已采纳

### 背景

etcd 挂掉时微服务怎么起？直觉是把配置也存一份到数据库，etcd 不可用时从库里捞。

### 决定

合并后的 YAML **原子覆写**到本地磁盘 `<snapshotDir>/<服务名>.snapshot.yaml`（默认 `data/config-cache`），etcd 不可用且快照存在时用快照启动，状态 `degraded`，后台每 5s 重连。

文件名**固定、直接覆盖**，不带时间戳后缀——冷启动时不需要挑「最新的那一份」，闭眼读这一个文件就行。写入走临时文件 + `rename`（`snapshot.atomicWriteFile`），保证并发读或进程崩溃时看不到写了一半的 YAML。

### 为什么不用数据库做灾备

三条，第一条就足以否掉：

1. **鸡生蛋。** 微服务启动时，连数据库的连接串 `database.default.link` 就在配置里。要先连库才能拿到配置，那它怎么知道库的 IP 和密码？
2. **故障相关。** etcd 连不上往往是机房断网、内网 DNS 故障、交换机问题——此时数据库大概率同样连不上。用一个同样依赖网络的组件去容灾网络故障，不成立。
3. **磁盘是底线。** 本地磁盘零网络依赖、零外部组件依赖，是单机容灾唯一物理上绝对安全的防线。

### 后果

- **既没有 etcd、又没有快照 ⇒ 启动直接失败。** 这是刻意的：宁可起不来，也不要带着半套配置上线。
- 容器部署时 `snapshotDir` **必须挂持久卷**，否则每次重建容器快照都是空的，容灾形同虚设。deploy-agent 已经这么挂（`data/instances/<svc>/cache:/app/data/config-cache`）。
- 快照文件写的是**未 sticky 的完整合并结果**。`stickyKeys` 只影响本次运行期的内存值，不污染灾备文件——下次冷启动仍拿到最新全量配置。

---

## D-03 etcd 账号严格只读，且 Watch 拆成两个前缀

**状态**：已采纳（实现细节为此而存在）

### 背景

不开权限时，SDK 拿的是 etcd root 账号。业务代码里一旦有人误写 `client.Put`，或者某个服务被攻破，它能**删掉其它所有服务的配置**。

### 决定

微服务专用账号，**只能 `Get` / `Watch`，严禁 `Put` / `Delete`**，且**只能读自己的路径**：

```bash
etcdctl user add root:RootPassword123
etcdctl auth enable

etcdctl role add shop-server-role
etcdctl role grant-permission shop-server-role --prefix=true read /config-center/shared/
etcdctl role grant-permission shop-server-role read /config-center/services/shop-server

etcdctl user add shop-user:ShopUserPass456
etcdctl user grant-role shop-user shop-server-role
```

越权读写直接 `permission denied`。生产脚本见 `configure-server/scripts/etcd-rbac.sh`；账号填 `svc.etcd.username` / `password`。

### 关键实现约束

**SDK 的 Watch 不是一个 `Watch /config-center/` 完事，而是拆成两个 goroutine**：

- `watchLoop(<prefix>/shared/, WithPrefix)` —— 公共配置，可授 `--prefix=true read`
- `watchLoop(<prefix>/services/<本服务>)` —— **精确 key**，不带前缀

这个拆分不是性能或整洁考虑，**就是为了 RBAC 可行**。合成一个前缀 watcher 的话，授权就得给到 `/config-center/` 整棵树的 `read`，任何服务都能读到别的服务的专属配置（里面可能有它自己的密钥）。精确 key 让「只看自己那一份」在 etcd 权限模型里能被表达。

同理，`Get` 也是分两次拉（`ListShared` + `GetService`），不是一次 `ListPrefix(/config-center/)`。

### 后果与现状

- 开发 compose **默认不开** etcd auth，本地体验不受影响。
- 上生产开 auth 时要同步改配置中心的**管理端**账号（它需要 `write` 权限，与微服务账号分开），且 `svc.etcd.host` 两边都要补凭据。
- `skipSharedWatch: true` 的服务实际上可以不申请 `shared/` 的读权限——但当前 seed 的 `shared/database` 是业务库连接串，绝大多数服务都需要。

---

## D-04 Boot 为什么从 `init()` 搬到 `cmd`

**状态**：已采纳（接入规范的硬性要求）

### 背景

GoFrame 项目里在 `init()` 或 `main.go` 空白 import 一个包来加载配置很常见，写起来短。

### 决定

`etcdcfg.Boot(ctx)` **必须在 `cmd.Main.Func` 函数体的最前面显式调用**，且早于第一次 `g.Server()` / `g.DB()` / `g.Redis()`。业务代码**禁止**在 `init()` 里连 etcd。

### 理由

业务运行效果**完全一样**——都是「先加载配置，再跑业务」。差别在工程健壮性，三条：

1. **摆脱黑魔法。** `init()` 的执行顺序是隐式的、由编译器按 import 链推导，团队成员很难一眼看出配置何时加载。`cmd` 里是显式调用，生命周期一目了然。
2. **可单测。** 放在 `init()` 里，只要 `go test` 编译到那个包就会强行联网连 etcd，断网环境单测全挂。搬进 `cmd` 后单测根本不触发这个网络请求——现在 33 个测试全部离线跑完约 1 秒，靠的就是这条。见 [测试](testing.md)。
3. **能优雅退出。** `cmd` 里失败可以 `return err`，由 `gcmd` 正常终止进程；`init()` 里失败只能 `log.Fatalf`（底层 `os.Exit(1)`），拿不到栈、也没法在退出前做清理。

### 唯一的坑

`main.go` 的空白 import 顺序**仍然是**隐式初始化顺序，但那一段只放 `internal/packed`、数据库/Redis 驱动、`internal/logic`（触发 `service.Register*`）。**etcd 相关的东西不能进这个列表。**

---

## D-05 审计历史：只增、BASELINE 快照、回滚等于新发布

**状态**：已采纳

### 背景

配置改错了要能追溯、能回退。标准配置中心需要记录：谁改的、什么时候、改了哪个 key、改了什么、为什么改。

### 决定

单表 `config_history`，只 INSERT：

| 列 | 作用 |
|----|------|
| `config_key` | etcd 全路径 |
| `version` | `MAX(version) + 1`，配 `(config_key, version)` 唯一索引 |
| `content` | **该版本当下的完整 YAML**（存快照，不存 diff） |
| `action_type` | `CREATE` / `UPDATE` / `BASELINE` / `DELETE` / `ROLLBACK` |
| `operator` | 取自 **JWT 登录名**，忽略请求体的 `operator` 字段 |
| `remark` | 变更说明 |
| `created_at` | |

### 三个不那么显然的选择

**存全量 YAML，不存 diff。** diff 需要在两个版本间重建上下文，一旦中间某条记录丢失就全崩；全量快照任何一行都能独立解读。代价是存储——配置文本几十 KB，一年几百条，可接受。

**`BASELINE`：首次修改某个 key 前，先把**修改前**的值补录一条。** 没有它，历史的第一条就是「新值」，你永远不知道原来是什么。同一次保存里 `BASELINE` 和 `UPDATE` 是两条记录。判定见 `logic/config.shouldWriteBaseline`（有单测）。

**回滚是一次新的发布，不是时光倒流。** `POST /configs/rollback` 从历史读出目标版本的 YAML，再走一次正常的 etcd Put + 追加一条 `action_type=ROLLBACK` 的**新版本**。历史线性、可审计，「谁在什么时候回滚过」本身就是信息。选到当前版本会被拒（`该版本已是当前配置，请选择更早的历史版本`）——回滚到它等于没动。

### 操作人伪造

请求体里有 `operator` 字段是历史包袱（未登录场景留下的）。controller 一律用 `ctx` 里的登录名覆盖它，所以审计记录不可被调用方伪造。强制 seed 额外要求 `role=admin`。

---

## D-06 `stickyKeys` 默认为空 = 全部热重载

**状态**：已采纳

### 背景

热更新能改内存里的 YAML，但**改不了已经建立的 DB 连接池、Redis 客户端、HTTP 监听端口**。把这些也标成「可热更新」会误导使用者。

### 决定

`sdk.etcd.stickyKeys` 列出**不参与热重载**的根 key。**不配置时所有根 key 都是 live 热重载**，包括 `database`。

### 为什么不默认冻结 `database`

因为「默认冻结」会让人以为热更新对数据库无效，从而放弃用它改超时、日志级别这类真正能生效的项。现在的语义是一句话能说清的：

> **热重载只换内存。** 换了之后能不能观察到效果，取决于消费方有没有在每次使用时读 `g.Cfg()`。

- 业务代码每次请求 `g.Cfg().MustGet(ctx, "test.shopName")` → 立刻生效（shop-server 的 `/config/runtime` 就是这个演示）。
- 启动时建好连接池的 `database` → 值变了，连接还是旧的 → 看起来「没生效」。

于是给出一条明确建议：**换 DSN 要滚动重启；如果你希望这种改动被诚实地忽略，把 `database` 写进 `stickyKeys`。**

### 副作用

`stickyKeys` 的判断只看**根 key**，粒度是整个 `database` 段，做不到「只冻结 `link` 不冻结 `debug`」。这是有意的简化：根 key 就是 GoFrame 的配置命名空间，按它切最符合直觉。

性能上，`shouldSkipReload` 会在「一批事件全部命中 sticky 的 shared 名」时**完全跳过 etcd 拉取**（有单测），加上 150ms 防抖，公共配置高频变更不会把服务打成不断全量重载。

---

## D-07 发布页的「灰度」是发布编排，不是流量灰度

**状态**：已采纳（并被反复误解，因此写进文档多处）

### 背景

「灰度发布」在中文语境里默认含「用户无感、按比例切流量」。配置中心的发布页有「灰度」按钮，很容易被认为实现了这件事。

### 决定

发布页只负责**把镜像在哪些机器、哪个端口跑起来**，**不切用户流量**。

| 策略 | 行为 |
|------|------|
| 灰度·多节点 | 前 N 台 `pending`，其余 `waiting`；验证通过后「推进其余节点」 |
| 灰度·单节点旁路 | 填 `canaryHostPort`，旧容器不动，新版本以 `cc-<服务>-canary` 跑在旁路端口 |
| 全量 | 选中节点同时替换主容器 |

旁路灰度的约束是服务端硬校验的：只能选一台、灰度端口不能等于主端口。

### 为什么

正确的用户无感闭环必须有一个**读配置的网关**：

```
1. 旧实例在主端口服务，用户仍走 网关 → 旧实例
2. 发布页用旁路端口拉起新 tar（cc-<服务>-canary），此时没有用户会打到它
3. 在配置中心写网关路由（白名单 user/IP/Header 或百分比），网关 Watch etcd 后
   只把命中名单的请求转到 canary
4. 验证通过 → 网关切到 100% 新 → 发布页「转正」替换主容器、下线 canary
   失败 → 关掉白名单，旧实例一直在
```

**本仓库没有网关进程。** `shop-server` 不会自己按白名单把流量分给另一份自己。把白名单写进业务服务的配置里也不会生效——需要读它的是独立的 `gateway-server`。

### 顺带说明

`docker rm -f` + `docker run` 是**替换**，不是优雅停止。探针没有实现连接排空，滚动升级期间的在途请求由上游网关负责。

---

## D-08 交叉小决定

| 决定 | 理由 |
|------|------|
| 探针用 `exec.Command("docker")`，不用 Docker SDK | 少一个依赖；行为与运维手敲的 `docker` 完全一致，排查时不用翻译成 SDK 语义 |
| 探针**不打成镜像**，用二进制 + systemd | 容器里读到的 CPU/内存是探针自己的 cgroup 配额，节点推荐失真；挂载路径也会和 dockerd 看到的宿主机路径不一致 |
| 资源数据缺失记为 `-1`「未上报」，不当 0% 空闲 | 当成 0% 会让没上报指标的机器在节点推荐里排第一。`TestUnknownUsageIsNotTreatedAsIdle` 守这条不变量 |
| 镜像 `FROM scratch` | 产物只有 `/app/main`，几十 MB 降到几 MB。代价是没有 shell / CA / 时区，由探针补挂 `/etc/ssl/certs` 和 `-e TZ=` |
| `Watch: false` 时 `Get` 改成每次**实时读 etcd**，而不是冻结 | 「关掉热更新」的自然语义是「我要现值但不要推送」，而不是「停在启动时的值」——后者是 `stickyKeys` 的职责 |
| 只有 `cc-` 前缀的容器会被上报 | 让探针和配置中心对「什么算本中心管理的容器」有一致定义。配置中心自己的容器**不能**用 `cc-` 前缀 |
| YAML 校验放在服务端 | 前端能校验格式，但服务端的 `yamlToMap` 才是唯一权威；根节点必须是 map，否则拒写，防止打挂所有 Watch 该 key 的微服务 |
| Agent 产物下载路由不带 `MiddlewareHandlerResponse` | 要返回原始 tar 字节流。这是 `cmd.go` 里存在两组路由的唯一原因 |
| etcd key 前缀可配（`svc.etcd.prefix`） | 一套 etcd 服务多个隔离环境时不换集群，只换前缀 |

---

## 参考出处

- 底稿：仓库早期放在根目录的设计问答 `optimize.md`，文档整理时已删除，内容并入 D-02 / D-03 / D-04 / D-05（其中 `config_info` 双写方案被 D-01 推翻）。需要原文时用 `git log --diff-filter=D --name-only -- optimize.md` 找到删除前的提交再 `git show <commit>:optimize.md`。
- 实现细节：[架构与实现链路](../02-reference/architecture.md)
- 行为契约：[etcdcfg SDK](../02-reference/etcdcfg-sdk.md)、[deploy-agent](../02-reference/deploy-agent.md)
- 数据落地：[数据库表结构](../02-reference/database-schema.md)
