# 配置中心前端

Vite 7 + React 19 + shadcn/ui（Radix）+ Tailwind CSS 4 的中台控制台，只对接 `configure-server` 的 HTTP API。

权威文档在 `docs/`：

| 你要做什么 | 看哪里 |
|------------|--------|
| 本地跑起来 | [快速开始](../docs/01-getting-started/quickstart.md#5-起中台前端) |
| 目录结构、路由与鉴权流、页面对应接口、组件约定、11 张界面截图 | [中台前端](../docs/02-reference/web-console.md) |
| 后端接口字段 | [HTTP API 参考](../docs/02-reference/api.md) |
| 改代码 | [贡献指南](../CONTRIBUTING.md#前端) |

## 开发

```bash
npm install
npm run dev        # :5173，/api 代理到 http://127.0.0.1:9000
npm run build      # tsc && vite build → dist/
npm run preview
```

需要先起 configure-server，否则所有接口 502。

登录账户来自 `configure-server/manifest/config/config.yaml` 的 `auth.users`（本地默认 `admin` / `admin123`）。
