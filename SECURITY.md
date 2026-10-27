# 安全策略

## 报告漏洞

**请不要开公开 Issue 报告安全问题。**

- Gitee：向仓库负责人发私信，或提交 Gitee 安全响应中心渠道
- 邮件：`linwei688668@gmail.com`

请在报告里说明版本或提交号（`git rev-parse --short HEAD`）。我们会在 **7 天内**回复确认，**30 天内**给出评估结论。修复发布后，我们可以在披露时间到达后把你列为致谢人。

## 支持范围

本项目没有 LTS 分支，**只对 `master` 提供安全修复**。

## 版本与部署边界

这是一套面向**内网 / 私有部署**的配置中心与发布编排工具，安全模型假设它运行在受控网络里。把它直接暴露到公网之前先读完下面这一节。

## 上线前必须处理的默认值

`configure-server/manifest/config/config.yaml` 不进仓库（各模块 `.gitignore` 排除了它），但 `config.example.yaml` 里的占位值会被打进 `FROM scratch` 镜像。**部署时必须用卷覆盖这三个值**，否则等于用公开在仓库里的凭据运行：

| 配置项 | 示例值 | 风险 |
|--------|--------|------|
| `auth.jwtSecret` | `configure-center-dev-secret-change-me` | HS256 密钥公开 ⇒ 任何人可伪造 admin token |
| `auth.users[].password` | `admin123` / `operator123` | 弱口令；若 `auth_users` 表为空会直接生效 |
| `auth.agentToken` / `agent.token` | `dev-agent-token` | 拿到即可在任意节点执行 `docker rm -f` / `docker run` |

生成随机密钥：

```bash
openssl rand -base64 48
```

## 已知的设计边界

这些不是漏洞，是使用前必须知道的边界。

### 1. Agent 令牌是全局单一凭据

`auth.agentToken` **所有节点共用一个**，不是每节点独立令牌。持有该令牌 = 能在任意已注册节点上以 root 权限执行 `docker load` / `docker rm -f` / `docker run`。

缓解：把 `/api/v1/agent/*` 限制在运维网段；令牌轮换流程见 [deploy-agent](./docs/02-reference/deploy-agent.md#安全边界)。

### 2. 节点探针以 root 运行

探针必须能调本机 `docker`，等价于配置中心对这些机器拥有 docker 级控制权。**不要把配置中心的 `jwtSecret` 交给不受信任的使用方**——拿到 admin token 可以通过发布接口在节点上跑任意镜像。

### 3. 配置内容不加密

etcd 里的 YAML 是明文。数据库口令、第三方 API key 会出现在 `/config-center/shared/database` 这样的 key 上，任何有 etcd 读权限的账号都能看到。

缓解：生产**必须**开 etcd RBAC（`configure-server/scripts/etcd-rbac.sh`），给每个服务只授 `shared/` 前缀 + 自己那条精确 key 的 `read`。开发 compose 默认**不开**认证，不要直接搬到生产。

### 4. JWT 无主动失效

HS256 token 在 `auth.expire`（默认 24h）内一直有效，**服务端没有撤销列表**。改了 `jwtSecret` 会让所有已签发 token 立刻失效，这也是目前唯一的吊销手段。

登录失败锁定（5 次 / 10 分钟）计数在**进程内存**里，重启即清零，多实例部署时不共享。

### 5. OpenAPI schema 不经鉴权

`GET /api.json` 和 `/swagger/` 不经过 JWT 路由，未登录可读，会暴露所有接口的字段结构。里面没有密钥，但对外网部署建议在反向代理上关掉。

### 6. 上传的 tar 不校验来源

配置中心计算并记录 `sha256`，但**不做签名校验**。能访问发布页并上传的账号，可以在节点上跑任意镜像。发布页权限等同于节点 root，分配 `role` 时按此考虑。目前只有 `admin` / `operator` 两档，没有更细的权限。

### 7. CORS 默认放开

`middleware.CORS` 对开发便利做了宽松处理。中台与 API 同源部署（nginx 反代 `/api`）时，建议在代理层收紧跨域头。

### 8. HTTP 明文

配置中心和探针之间走 HTTP。跨主机部署应由反向代理终止 TLS，或把整条链路放在内网隔离环境里。探针的 `agent.server` 支持 `https://`，但需要自行处理证书。

## 依赖安全

四个 Go 模块的依赖集中在 `go.work`（见 [仓库结构与构建](./docs/03-development/repo-layout.md)）。定期自查：

```bash
go vet ./...
govulncheck ./...          # 需要 golang.org/x/vuln/cmd/govulncheck
npm --prefix web audit
```

前端构建依赖 Vite / React / antd，运行时**不含 Node**——`web/dist` 是纯静态文件，服务器不需要 Node 运行时。

## 已修复

| 日期 | 内容 |
|------|------|
| 2026-10 | 文档整理时确认：本地 `manifest/config/config.yaml`（含 `jwtSecret`、账户口令、`agentToken`）在三个模块的 `.gitignore` 里均已排除，未被提交。写配置的 controller 忽略请求体 `operator`、一律取 JWT 登录名，审计记录不可被调用方伪造。 |
