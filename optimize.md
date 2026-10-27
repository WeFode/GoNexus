### 1. 关于“本地磁盘快照缓存”

#### (1) 存在哪里？
* **建议路径**：存放在应用根目录的临时目录或系统固定缓存目录下。
  * **传统/物理机部署**：`./temp/config-cache/` 或 `/var/tmp/app-name/`。
  * **Docker 部署**：容器内的固定目录（如 `/app/temp/config-cache/`）。
  * 只要保证程序对这个目录有**读写权限**即可。

#### (2) 文件格式要带时间戳后缀吗？
* 必须是**固定文件名**（例如：`shop-server.snapshot.yaml`）。
* **正确做法（覆写/原子写入）**：
  每次微服务**成功连接 Etcd** 并拉取到完整配置、或者 Watch 监听到合法变更后，**直接覆盖**这个 `shop-server.snapshot.yaml`。这样只要服务启动连不上 Etcd，闭着眼直接去读这一个固定文件就行。

#### (3) 为什么不存入数据库？
这是最关键的一个逻辑闭环：**微服务不能依赖数据库来做配置灾备！**
* **先有鸡还是先有蛋**：
  你的微服务启动时，连数据库的连接串 `database.default.link` 就在配置里！如果微服务要先连数据库才能拿到配置，那它怎么知道数据库的 IP 和密码呢？
* **网络依赖风险**：
  Etcd 连不上往往是因为机房断网、内网 DNS 故障、交换机故障。此时通常数据库大概率也连不上。
* **磁盘是最终底线**：
  本地磁盘**零网络依赖、零外部组件依赖**，是单机容灾唯一的“物理绝对安全防线”。

---

### 2. 微服务 Etcd 账号“严格只读”是什么意思？怎么设置？

#### (1) 什么是严格只读？
* **现状风险**：如果不设权限，微服务里的 SDK 拥有整个 Etcd 的 Root 权限，一旦业务代码里有漏洞，或者某个实习生把 `etcd.Put()` 写进了微服务业务逻辑，它甚至能**反向删掉 Etcd 里所有其他服务的配置**。
* **严格只读**：为微服务创建一个专门的 Etcd 账号，该账号：
  * **只能 `Get` / `Watch`**，严禁 `Put` / `Delete`。
  * **只能读自己的专属路径和公共路径**（如 `/config-center/shared/` 和 `/config-center/services/shop-server`），不能读取别的服务（如 `/config-center/services/payment-server`）的机密。

#### (2) 怎么通过 Etcd RBAC 设置？
在搭建好的 Etcd 容器中执行如下 `etcdctl` 命令即可完成权限绑定：

```bash
# 1. 开启 etcd 的认证系统（需先创建 root 账号，避免把自己锁在外面）
etcdctl user add root:RootPassword123
etcdctl auth enable

# 2. 创建一个给 shop-server 专用的角色
etcdctl role add shop-server-role

# 3. 给这个角色授予「只读 (read)」且「限定前缀」的权限
# 允许读公共配置前缀
etcdctl role grant-permission shop-server-role --prefix=true read /config-center/shared/
# 允许读自己专属的服务配置
etcdctl role grant-permission shop-server-role read /config-center/services/shop-server

# 4. 创建 shop-server 专属的普通用户并绑定角色
etcdctl user add shop-user:ShopUserPass456
etcdctl user grant-role shop-user shop-server-role
```
此时，`shop-server` 的本地引导配置写 `shop-user:ShopUserPass456`。这个账号去写数据或尝试偷看别的微服务配置时，Etcd 会直接抛出 `permission denied` 拒绝。

---

### 3. `init()` 搬到 `cmd` 效果是一样的吗？

**业务运行效果完全一样，但工程健壮性提升了几个层级。**

#### (1) 为什么说效果一样？
GoFrame 项目的标准入口是 `main.go` -> 调用 `cmd.Main.Run(ctx)`。
在 `cmd.go` 中，你把加载配置的代码放在**业务逻辑的最上方**：

```go
// internal/cmd/cmd.go
var Main = gcmd.Command{
    Name:  "main",
    Usage: "main",
    Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
        // -------------------------------------------------------------
        // 1. 在这里显式执行 Boot（取代原来的 init）
        // -------------------------------------------------------------
        if _, err := etcdcfg.BootFromLocal(ctx); err != nil {
            return err // 优雅返回错误，退出进程，避免了难看的 Panic / Fatal
        }

        // -------------------------------------------------------------
        // 2. 从这里开始，配置已经就绪，后续代码行为与原先 init() 完全一致
        // -------------------------------------------------------------
        s := g.Server()
        s.Group("/", func(group *ghttp.RouterGroup) {
            group.Bind(controller.Hello)
        })
        s.Run()
        return nil
    },
}
```

#### (2) 搬到 `cmd` 带来的巨大好处：
1. **摆脱黑魔法**：Go 语言的 `init()` 执行顺序是隐式的、由编译器根据 import 链推导的，团队其他成员很难一眼看出代码何时加载了配置。搬到 `cmd.go` 是**显式调用，生命周期一目了然**。
2. **便于单元测试（Unit Test）**：如果你要单测一个工具函数（如 `internal/service/calc.go`），在原方案下，只要你跑 `go test`，`boot.go` 里的 `init()` 就会强行联网连 Etcd，断网测试直接挂；搬到 `cmd` 后，单测根本不会触发这个网络请求。
3. **安全退出**：在 `cmd` 里失败可以 `return err`，让程序优雅终止；而在 `init()` 里失败你只能调用粗暴的 `log.Fatalf`（底层直接强行杀死进程 `os.Exit(1)`）。

---

### 4. 审计日志和回滚机制怎么做？

这个能力属于 `configure-server`（配置中心服务端），**一定要建表，而且利用你现有的 PostgreSQL 是最自然的方式。**

#### (1) 审计日志要记录什么？
是的，标准的配置中心（参考 Nacos / Apollo）必须记录：
* **谁改的**（操作人 ID / 账号 / IP）
* **什么时候改的**（修改时间）
* **修改了哪个配置**（服务名 / Key）
* **改了什么**（修改前的完整 YAML vs 修改后的完整 YAML，或者 Diff）
* **为什么改**（发布说明 / 备注，如：“双十一临时调大 DB 线程池”）

#### (2) 数据库表设计（PostgreSQL 示例）

只需要在 Postgres 中建两张表：

##### ① `config_info`（存最新生效的配置状态）
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | SERIAL PK | 主键 |
| `config_key` | VARCHAR(255) UNIQUE | 如 `/config-center/services/shop-server` |
| `content` | TEXT | 当前最新的 YAML 内容 |
| `version` | INT | 当前版本号（如 5） |
| `updated_by` | VARCHAR(64) | 最后修改人 |
| `updated_at` | TIMESTAMP | 最后修改时间 |

##### ② `config_history`（核心：审计历史表，只增不改）
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | SERIAL PK | 主键 |
| `config_key` | VARCHAR(255) | 关联的 Key |
| `version` | INT | 递增版本号（1, 2, 3...） |
| `content` | TEXT | **该版本当下的完整 YAML 内容**（留快照） |
| `action_type` | VARCHAR(16) | `CREATE` / `UPDATE` / `DELETE` / `ROLLBACK` |
| `operator` | VARCHAR(64) | 操作人（登录后台的管理员账号） |
| `remark` | VARCHAR(255) | 修改原因/备注 |
| `created_at` | TIMESTAMP | 操作时间 |

---

#### (3) 核心业务流程与交互过程

##### 场景 A：管理员修改配置（发布新版）
1. **登录鉴权**：管理员登录 `configure-server` 后台（拿到 JWT/Session，获取到操作人如 `admin_zhangsan`）。
2. **提交修改**：前端提交新的 YAML 内容，并填写备注：“调整超时时间为5秒”。
3. **语法校验**：`configure-server` 检查 YAML 格式是否合法，不合法直接拦截（防止打挂微服务）。
4. **事务落库**：
   * `config_info` 更新 `content`，并将 `version = version + 1`。
   * 向 `config_history` **插入一条全新记录**，把这个版本的 YAML 原文完整存下来，记录修改人、时间和备注。
5. **推向 Etcd**：
   * 后端调用 `etcdClient.Put(ctx, key, content)`。
   * Etcd 触发 Watch 事件。
6. **微服务热生效**：`shop-server` 监听到变更，内存更新，并将最新内容顺手覆写至本地磁盘快照 `shop-server.snapshot.yaml`。

##### 场景 B：发生线上事故，执行一键回滚
1. **查看历史**：管理员打开前端页面的“版本历史”，界面调用 `GET /api/v1/configs/history/shop-server`，从 `config_history` 表里拉取该服务过去的修改轨迹（列表清晰展示：时间、修改人、版本 1/2/3/4）。
2. **版本比对（Diff）**：前端可以对比 Version 3 和当前 Version 4 的内容差异（比如发现 Version 4 误删了某行关键配置）。
3. **点击回滚**：管理员在 Version 3 旁边点击 **【一键回滚】**。
4. **后端的“回滚”实现原理**：
   * **不要做物理数据的删除或时光倒流**，回滚本质上是**一次新的发布**！
   * 后端从 `config_history` 中把 Version 3 的 YAML 文本读出来。
   * 将当前版本升级为 **Version 5**，其 `content` 等于 Version 3 的内容，`action_type = "ROLLBACK"`，`remark = "回滚至版本 3"`。
   * 把 Version 3 的内容执行 `etcdClient.Put(ctx, key, version3Content)` 写入 Etcd。
5. **生效**：微服务再次被 Watch 唤起，瞬间安全恢复到事故前的老版本配置。

这样一来，你的系统就实现了**容灾有底线（磁盘快照）、权限有隔离（只读账号）、代码有规范（显式Boot）、运维有追溯（审计回滚）**，这就是成熟企业级基础架构的标准闭环。