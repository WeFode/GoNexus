# 内网 Linux ARM64 离线部署

目标机是 **Linux ARM64（aarch64）** 且不能访问互联网，因此**不能** `docker pull`。由有网的打包机把镜像打成 tar，拷进内网后 `docker load`，再 `docker compose up -d`。

etcd、Postgres、Redis、configure-server、中台页面都用容器；**`deploy-agent` 用二进制 + systemd，不要放进 Docker**。

前提：目标机已装好 Docker Engine 和 compose 插件（`docker compose version` 能跑）。本文不含 Docker 引擎本身的离线安装。

架构与链路背景见 [架构与实现链路](../02-reference/architecture.md)。

## 1. 探针为什么用 systemd

`deploy-agent` 要替这台机器执行 `docker load` / `docker run`，并上报**整机** CPU、内存和已占用宿主机端口。

| | 二进制 + systemd | 再套一层容器 |
|--|--|--|
| `docker` 命令 | 直接用宿主机 CLI | 容器里还得再装一份 CLI，并挂载 `docker.sock` |
| 挂载路径 | Agent 写下的目录就是 dockerd 看到的宿主机路径 | 容器内路径和宿主机路径不一致，业务容器会挂错配置 |
| CPU / 内存 | 读本机 cgroup、`/proc` | 读到的是探针容器自己的配额，节点推荐会失真 |
| 离线物料 | 一个静态二进制，没有基础镜像 | 还要再准备一份 ARM64 镜像 |

用 systemd 拉起：Docker 就绪后启动、进程退出自动重启、日志进 `journalctl`。

## 2. 端口规划（单机）

| 进程 | 怎么跑 | 地址 |
|------|--------|------|
| etcd | compose `gf_etcd` | 宿主机 `2379` |
| Postgres | compose `gf_postgres` | 宿主机 `5433` → 容器 `5432` |
| Redis | compose `gf_redis` | 宿主机 `6380` → 容器 `6379` |
| configure-server | `docker-compose.app.yml`，`network_mode: host` | `9000` |
| 中台页面 | nginx 容器，同样 host 网络 | `8080`，把 `/api` 转到 `127.0.0.1:9000` |
| shop-server | 稍后由探针 `docker run` | 发布时填的宿主机端口，默认 `8000` |
| deploy-agent | systemd | 无监听端口，主动访问 `127.0.0.1:9000` |

configure-server 走宿主机网络，所以它 `config.yaml` 里的 `127.0.0.1` 指的就是上面这几个宿主机端口。

**业务容器不走 host 网络**：探针会给它们加 `--add-host host.docker.internal:host-gateway`，并把配置里的 `127.0.0.1` 改写成 `host.docker.internal`。因此 **2379 / 5433 / 6380 必须发布在 `0.0.0.0`**，不能写成 `127.0.0.1:5433:5432`，否则别的容器访问不到。用防火墙把这些端口限制给本机和运维网段，不要对整个办公网开放。

## 3. 在有网的机器上导出

架构必须是 `linux/arm64`。漏掉 `--platform` 时 Docker Desktop 会存成 amd64，目标机 `docker load` 后报 `exec format error`。

```powershell
# 基础设施镜像。名字必须和 configure-server/docker-compose.yml 里的 image 一致
docker pull --platform linux/arm64 quay.io/coreos/etcd:v3.5.21
docker pull --platform linux/arm64 postgres:16-alpine
docker pull --platform linux/arm64 redis:7-alpine
docker pull --platform linux/arm64 nginx:1.27-alpine

docker image inspect --format "{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}" `
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine nginx:1.27-alpine
# 每一行都必须是 linux/arm64

New-Item -ItemType Directory -Force -Path deploy\dist | Out-Null
docker save -o deploy\dist\infra-linux-arm64.tar `
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine
docker save -o deploy\dist\nginx-linux-arm64.tar nginx:1.27-alpine

# 应用镜像（FROM scratch，不拉基础镜像）
.\package.ps1 -Platform linux/arm64

# 探针：静态二进制，不要打成镜像
Push-Location deploy-agent
$env:CGO_ENABLED = "0"; $env:GOOS = "linux"; $env:GOARCH = "arm64"
go build -ldflags="-s -w" -o ..\deploy\dist\deploy-agent-linux-arm64 .
Pop-Location
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue

# 中台静态文件（开发机有 Node 即可，服务器不需要 Node）
Push-Location web
npm ci
npm run build          # 输出到 web/dist
Pop-Location
```

打包机上应备齐：

| 文件 | 内容 |
|------|------|
| `deploy/dist/infra-linux-arm64.tar` | etcd + Postgres + Redis |
| `deploy/dist/nginx-linux-arm64.tar` | 中台用的 nginx |
| `deploy/dist/configure-server-linux-arm64.tar` | 配置中心，镜像名 `configure-server:linux-arm64` |
| `deploy/dist/shop-server-linux-arm64.tar` | 示例业务，留给中台上传，**先不要在服务器上手工 `docker run`** |
| `deploy/dist/deploy-agent-linux-arm64` | 探针二进制 |
| `web/dist/` | 前端构建结果 |

`package.ps1` 会把**当时仓库里的** `config.example.yaml` 和 `manifest/etcd-seed` 烤进镜像。服务器上用卷盖掉这两处，改口令和数据库连接串就不必重新打包。

## 4. 拷到服务器

U 盘或内网拷贝，放到固定目录（路径可改，下文按这个写）：

```text
/opt/configure-center/
  dist/                          # 上面的 tar 和探针二进制
  configure-server/
    docker-compose.yml
    docker-compose.app.yml
    scripts/pg-init/00-init.sh
    manifest/sql/pgsql/          # 000、001、002、003、004
    manifest/config/config.yaml  # 由 example 复制后修改，必须是文件
    manifest/etcd-seed/          # shared/ 与 services/
    data/artifacts/              # 空目录，上传的 tar 落在这里
  web/dist/                      # npm run build 的输出
  nginx/nginx.conf
  deploy-agent/
    deploy-agent                 # 即 dist 里的二进制，改名为 deploy-agent
    manifest/config/config.yaml
```

`00-init.sh` 若从 Windows 拷来，先去掉 CR，否则 Postgres 首次初始化会失败：

```bash
sed -i 's/\r$//' /opt/configure-center/configure-server/scripts/pg-init/00-init.sh
mkdir -p /opt/configure-center/configure-server/data/artifacts
chmod +x /opt/configure-center/deploy-agent/deploy-agent
```

## 5. 改配置再启动

**口令要三处一致**：`docker-compose.yml` 的 `POSTGRES_PASSWORD`、configure-server 的 `database.default.link`、etcd seed 里 shop 用的 `database.default.link`。Postgres 只在**数据卷第一次创建**时采纳密码；卷已存在后再改环境变量不会改掉库里的口令。

`configure-server/manifest/config/config.yaml`（从 `config.example.yaml` 复制）：

```yaml
server:
  address: ":9000"
  openapiPath: "/api.json"
  swaggerPath: "/swagger"
  clientMaxBodySize: "512MB"

logger:
  level: "all"
  stdout: true

database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/config_center"
    debug: false

svc:
  etcd:
    host: "127.0.0.1:2379"        # 配置中心自己不加 @服务名
    seedDir: "manifest/etcd-seed"

auth:
  jwtSecret: "换成足够长的随机串"
  expire: "24h"
  users:
    - username: admin
      password: "换成管理员密码"
      role: admin
  observabilityToken: "换成独立的日志上报令牌"
  agentToken: "换成与探针相同的令牌"

deploy:
  artifactDir: "data/artifacts"
  jobTimeout: "10m"
```

仓库里的 `manifest/etcd-seed/shared/database.yaml` 若仍是达梦连接串，微服务会去连达梦。上线前改成 Postgres，并确认 Redis 端口是**宿主机侧**的 `6380`：

```yaml
# shared/database.yaml —— 这是 shop 的业务库 app_db，不是 config_center
database:
  default:
    link: "pgsql:postgres:123456@tcp(127.0.0.1:5433)/app_db"
    debug: false
```

```yaml
# shared/redis.yaml
redis:
  default:
    address: 127.0.0.1:6380
    db: 0
```

`services/shop-server.yaml` 保持服务自己的 `server.address: ":8000"` 即可。seed 只在 etcd 里还没有这个 key 时写入，**第一次启动前改对**，避免之后只能调强制 seed 覆盖。

探针 `deploy-agent/manifest/config/config.yaml`：

```yaml
agent:
  nodeId: "arm64-1"
  server: "http://127.0.0.1:9000"
  token: "与上面 auth.agentToken 相同"
  interval: "10s"
  dockerNetwork: ""
  loopbackAs: "host.docker.internal"
```

中台 `/opt/configure-center/nginx/nginx.conf`：

```nginx
server {
    listen 8080;
    server_name _;
    client_max_body_size 512m;
    root /usr/share/nginx/html;
    location /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`config.yaml` 和 `nginx.conf` **必须先是文件**。若文件还不存在就执行 `compose up`，Docker 会按卷路径建出一个同名**目录**，进程起不来。

## 6. 导入镜像并拉起基础设施

```bash
cd /opt/configure-center
docker load -i dist/infra-linux-arm64.tar
docker load -i dist/configure-server-linux-arm64.tar
docker load -i dist/nginx-linux-arm64.tar

docker image inspect --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}' \
  quay.io/coreos/etcd:v3.5.21 postgres:16-alpine redis:7-alpine \
  configure-server:linux-arm64 nginx:1.27-alpine

cd configure-server
docker compose up -d --pull never
docker compose ps
```

`--pull never` 保证这台机器不会去访问镜像仓库。三个容器都变 healthy 再继续。

初始化脚本只在 `gf_pg_data` 为空时执行：建 `config_center`（审计、节点、发布、账户表）和 `app_db`（`002_shop_schema.sql` 里的商品表）。表结构见 [数据库表结构](../02-reference/database-schema.md)。

```bash
docker exec gf_etcd etcdctl endpoint health --endpoints=http://127.0.0.1:2379
docker exec gf_postgres pg_isready -U postgres -d config_center
docker exec gf_postgres pg_isready -U postgres -d app_db
docker exec gf_redis redis-cli ping
```

## 7. 拉起 configure-server

```bash
docker compose -f docker-compose.app.yml up -d --pull never
docker logs -f configure-server
```

日志里应能看到 seed 写入条数。etcd 连不上会直接退出；审计库连不上只告警，但历史和发布接口之后会失败——所以第 6 步要等 Postgres healthy 再做这一步。

```bash
curl -sS http://127.0.0.1:9000/api/v1/health
docker exec gf_etcd etcdctl get /config-center/shared/database --print-value-only
```

第二条应是 `pgsql:...@tcp(127.0.0.1:5433)/app_db`，而不是达梦。Swagger：<http://<服务器IP>:9000/swagger/>。

中台页面：

```bash
docker run -d --name configure-web --restart unless-stopped --network host \
  -v /opt/configure-center/web/dist:/usr/share/nginx/html:ro \
  -v /opt/configure-center/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27-alpine
```

浏览器打开 `http://<服务器IP>:8080`，用 `config.yaml` 里的管理员账号登录。页面与 API 同源，nginx 把 `/api` 转到本机 `9000`。

## 8. 安装探针（systemd）

```bash
install -m 755 /opt/configure-center/dist/deploy-agent-linux-arm64 \
  /opt/configure-center/deploy-agent/deploy-agent
```

`/etc/systemd/system/deploy-agent.service`：

```ini
[Unit]
Description=configure-center deploy agent
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=/opt/configure-center/deploy-agent
ExecStart=/opt/configure-center/deploy-agent/deploy-agent
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now deploy-agent
journalctl -u deploy-agent -f
```

三个要点：

- `WorkingDirectory` 必须是探针目录，否则读不到 `manifest/config/config.yaml`。
- 进程以 root 运行，才能调本机 `docker`。
- 日志里应出现 `node=arm64-1`，且没有持续的 `docker info` 报错。

约 45 秒内中台「节点」页显示在线，平台 `linux/arm64`，带 CPU / 内存读数。改探针配置后 `systemctl restart deploy-agent`。

## 9. 用中台发布 shop-server

不要在服务器上对 shop 手工 `docker run`。把 `shop-server-linux-arm64.tar` **保持这个文件名**上传到发布页（文件名里的 `linux-arm64` 会被识别成平台 `linux/arm64`、镜像 `shop-server:linux-arm64`），选节点 `arm64-1`，宿主机端口 `8000`，下发。

探针随后：下载 tar → `docker load` → 写实例配置（etcd 地址为 `host.docker.internal:2379@shop-server`）→ 拉起 `cc-shop-server`。容器内的 `127.0.0.1:5433` / `:6380` 被改写成 `host.docker.internal`，从而连到本机 compose 发布的 Postgres 和 Redis。

```bash
curl -sS http://127.0.0.1:8000/api/v1/health
docker ps --filter name=cc-shop-server
```

## 10. 验收与以后怎么改

| 检查 | 期望 |
|------|------|
| `docker compose ps` | `gf_etcd`、`gf_postgres`、`gf_redis` 为 healthy |
| `curl :9000/api/v1/health` | 成功，etcd 可达 |
| etcd `shared/database` | Postgres `app_db`，端口 5433 |
| `systemctl is-active deploy-agent` | `active` |
| 中台节点页 | `arm64-1` 在线，平台 `linux/arm64`，有 CPU / 内存 |
| `curl :8000/api/v1/health` | shop 已发布，`configFrom = etcd` |

以后：

- **只改业务配置**：在中台改 YAML，不必重新导 tar。
- **换镜像**：打包机重新 `package.ps1 -Platform linux/arm64`，新 tar 拷进内网，中台上传后再发布。
- **改了 configure-server 的 `config.yaml` 或 seed 目录**：

```bash
cd /opt/configure-center/configure-server
docker compose -f docker-compose.app.yml up -d --pull never
```

已经写进 etcd 的 key，普通重启不会覆盖。需要强制覆盖时用管理员账号调 `POST /api/v1/configs/seed`，body 为 `{"force": true}`。

**不要 `docker compose down -v`**，否则 Postgres 和 etcd 的数据卷会一起删掉。需要补表而不是重建时，在库已存在的情况下手工执行 `manifest/sql/pgsql/003_node_metrics.sql`、`004_auth_users.sql`（都带 `IF NOT EXISTS`，可重复）。

## 11. 失败时先看哪里

| 现象 | 原因 |
|------|------|
| 容器 `exec format error` | tar 是 amd64。回打包机检查 `docker image inspect` 的 Architecture 后重新 `docker save` |
| `compose up` 仍去拉镜像 | 没加 `--pull never`，或 `docker load` 后的仓库名/标签与 compose 里的 `image` 不一致 |
| Postgres 一直重启，日志有 `$'\r'` | `00-init.sh` 是 Windows 换行。按 §4 做 `sed` 后**删除数据卷**再 up（初始化失败的卷不会重跑脚本） |
| 配置中心退出，日志连不上 etcd | 先等 `gf_etcd` healthy；确认 app compose 是 `network_mode: host` |
| 微服务连不上数据库 | seed 仍是达梦，或端口写成了容器内的 5432/6379。宿主机侧是 5433 和 6380 |
| 节点页没有这台机器 | `agentToken` 不一致、`server` 不是 `http://127.0.0.1:9000`，或 systemd 的 `WorkingDirectory` 不是探针目录 |
| 发布被拒绝，架构不一致 | 上传的 tar 文件名不是 `*-linux-arm64.tar`，或探针上报的不是 `linux/arm64` |
| 中台能开页但接口 404 | nginx 没把 `/api/` 代理到 `127.0.0.1:9000`，或 configure-server 没在 host 网络的 9000 上 |

更多见 [常见问题](troubleshooting.md)。
