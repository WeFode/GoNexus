# 文档索引

`configure-center` 的文档分三档：**怎么用**、**怎么实现**、**怎么参与**。

## 01 使用文档

| 文档 | 解决什么问题 |
|------|--------------|
| [快速开始](01-getting-started/quickstart.md) | 单机跑通配置中心 + 微服务 + 中台页面 |
| [接入新微服务](01-getting-started/integrate-a-service.md) | 已有 GoFrame 服务接入配置中心 |
| [打包与发布](01-getting-started/release-and-rollout.md) | 出 tar、灰度/全量、转正、回滚、节点启停 |
| [内网 ARM64 离线部署](01-getting-started/deploy-offline-arm64.md) | 目标机不能访问镜像仓库 |
| [常见问题](01-getting-started/troubleshooting.md) | 报错先看这里 |

## 02 技术文档

| 文档 | 内容 |
|------|------|
| [架构与实现链路](02-reference/architecture.md) | 运行时拓扑、两条业务链路、GoFrame 分层、关键文件调用顺序、设计边界 |
| [HTTP API 参考](02-reference/api.md) | 全部端点、请求响应字段、鉴权矩阵 |
| [etcdcfg SDK](02-reference/etcdcfg-sdk.md) | `gcfg.Adapter` 实现、合并算法、Watch 与防抖、快照容灾 |
| [配置项字典](02-reference/configuration.md) | 四个模块的本地配置与 etcd 下发配置 |
| [数据库表结构](02-reference/database-schema.md) | `config_center` 六张表 + 达梦对齐 + 初始化脚本 |
| [deploy-agent](02-reference/deploy-agent.md) | 心跳协议、任务动作、docker 命令、健康探测与自动回滚、资源采集 |
| [中台前端](02-reference/web-console.md) | 11 张界面截图与逐页说明、路由、页面对应接口、鉴权流、构建产物 |

截图原文件在 `assets/screenshots/`，全部由本地 mock 后端渲染，**服务名、节点、镜像、时间都是虚构数据**，不含任何真实环境信息。

## 03 开发文档

| 文档 | 内容 |
|------|------|
| [仓库结构与构建](03-development/repo-layout.md) | `go.work` 多模块、Makefile 目标、`gf pack`、打包脚本内部逻辑 |
| [测试](03-development/testing.md) | 现有测试范围、为什么单测不连 etcd |
| [设计决策记录](03-development/design-decisions.md) | 快照为什么落磁盘、RBAC 为什么拆前缀、`init()` 为什么搬到 `cmd`、审计与回滚为什么这样设计 |

## 仓库治理文件

| 文件 | 用途 |
|------|------|
| [../README.md](../README.md) | 项目入口与导航 |
| [../LICENSE](../LICENSE) | MIT 许可证 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程、代码规范、提交与 PR 约定 |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本变更记录（Keep a Changelog） |
| [../SECURITY.md](../SECURITY.md) | 漏洞报告方式与已知的安全边界 |
| [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 行为准则 |
| `../.github/` · `../.gitee/` | Issue / PR 模板（远端是 Gitee，两套都保留） |

## 阅读顺序建议

- **只想跑起来**：[快速开始](01-getting-started/quickstart.md) → [常见问题](01-getting-started/troubleshooting.md)。
- **要接自己的服务**：[接入新微服务](01-getting-started/integrate-a-service.md) → [etcdcfg SDK](02-reference/etcdcfg-sdk.md)。
- **要改配置中心代码**：[架构与实现链路](02-reference/architecture.md) → [HTTP API 参考](02-reference/api.md) → [贡献指南](../CONTRIBUTING.md)。
- **要上线到内网**：[打包与发布](01-getting-started/release-and-rollout.md) → [内网 ARM64 离线部署](01-getting-started/deploy-offline-arm64.md)。
