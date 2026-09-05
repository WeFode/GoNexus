# 配置中心前端

Vite + React 19 + Ant Design 6 + Tailwind CSS 4 的中台控制台，对接 `configure-server` HTTP API。

## 本地开发

先启动配置中心（`:9000`），再：

```bash
cd web
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5173 。Vite 将 `/api` 代理到 `http://127.0.0.1:9000`。

## 功能

| 页面 | 对应接口 |
|------|----------|
| 概览 | `GET /api/v1/health`、列表统计、`POST /api/v1/configs/seed` |
| 公共配置 | `/api/v1/configs/shared` CRUD |
| 服务配置 | `/api/v1/configs/services` CRUD + 合并预览 |

后续业务模块可在 `src/pages` 增加路由，并在 `src/layouts/AdminLayout.tsx` 的菜单中注册。
