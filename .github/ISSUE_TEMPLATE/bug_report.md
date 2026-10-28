---
name: 问题反馈
description: 提交一个 bug 或异常行为
title: "[Bug] "
labels: bug
---

## 发生了什么

<!-- 简明描述现象。报错请贴原文，本项目大量错误信息是中文，直接复制即可。 -->

## 期望行为

## 如何复现

<!-- 最小复现步骤。涉及配置下发时请附上相关 YAML 片段（记得脱敏）。 -->

1.
2.
3.

## 环境

| 项 | 值 |
|----|----|
| 提交号 | `git rev-parse --short HEAD` |
| 操作系统 / 架构 | 例如 Windows 11 x64、Linux arm64 |
| Go 版本 | `go version` |
| Docker 版本 | `docker version --format '{{.Server.Version}}'` |
| Node 版本（前端问题） | `node -v` |
| 审计库 | PostgreSQL / 达梦 DM8 |
| 涉及模块 | pkg/etcdcfg / configure-server / shop-server / deploy-agent / web |

## 相关日志与接口响应

```
配置中心日志、探针 journalctl、curl 响应
```

## 排查过程（可选）

已经试过什么、排除了哪些可能。

## 检查清单

- [ ] 我搜索过已有 Issue，没有找到重复
- [ ] 我已脱敏 `jwtSecret`、`agentToken`、数据库口令等敏感信息
- [ ] **这不是安全漏洞** —— 安全问题请按 [SECURITY.md](../../SECURITY.md) 私密报告，不要开公开 Issue
