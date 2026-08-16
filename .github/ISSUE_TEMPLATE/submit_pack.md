---
name: 提交整合包
about: 把你的 DSH 整合包收录进 DSH Market 整合包分区
title: "[提交整合包] <整合包名称>"
labels: submission
---

感谢提交整合包！每日 06:00 的自动收录管道会检测你的仓库并校验包内条目。

## 整合包信息

- **仓库地址**：https://github.com/owner/repo （必填）
- **一句话简介**：（选填，将显示在市场卡片上）
- **包类型**：skill 技能包 / cordis 插件包 / MCP 包 / 混合包 / 主题包 / 其他

## 收录条件（满足其一即可）

- [ ] 仓库根目录有 `dsh.pack.json`（推荐，协议格式见 [dsh-bundler SPEC](https://github.com/2BingLing/dsh-bundler)）
- [ ] 仓库根目录有 `pack.json` 或 `*.pack.json` 清单文件（含插件列表 `plugins` 数组）

> 没有清单文件也没关系——**人工确认**：描述清楚"包含哪些插件/技能 + 怎么安装"，我们会人工收录。

## 校验说明

收录后每日自动校验：包内每个条目（插件/技能）是否存在、是否已在市场收录，并在详情页展示**解析率**。失效条目会标注原因，不影响整包收录。

## 其他

- 想挂收录徽章？收录后见 [PLUGIN-BADGE.md](https://github.com/2BingLing/dsh-market/blob/master/PLUGIN-BADGE.md)
- 修正数据/移除收录：回复本 issue 即可
