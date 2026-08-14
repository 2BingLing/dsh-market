---
name: 提交插件收录
about: 把一个新的 DeepSeek Harness 插件提交到 DSH Market（自动收录会尽快处理）
title: "[提交插件] 插件名称"
labels: ["submission"]
---

## 插件信息

- **GitHub 仓库地址**：(必填，如 https://github.com/owner/repo)
- **插件类型**：(skill / cordis-plugin)
- **一句话简介**：(必填，用什么语言都可以，我们会生成中文简介)
- **是否已打 dsh-plugin 相关 topic**：(建议打上 `dsh-plugin` topic，有助于自动收录)

## 补充说明（可选）

- 有什么独特功能或使用场景？
- 是否需要额外配置（API Key 等）？
- 有没有截图或演示链接？

---

> 💡 提示：DSH Market 是 **DeepSeek Harness 生态**的收录平台，收录条件是仓库**确实是 DSH 插件**：
> - skill 型：根目录有 `SKILL.md`（或 `skills/` 目录内含 SKILL.md）
> - cordis 型：有 `cordis.patch.yml` / `dsh.profile` 等标记，或 package.json 依赖含 cordis 关键字
>
> 两种提交方式都会被每日管道处理：
> 1. **打 `dsh-plugin` topic** —— 最快，每日自动扫描进入候选池（打了 topic 但无插件标记的仓库会被特征检测过滤，不会收录）；
> 2. **提交本 issue** —— 仓库地址自动进入候选池，走相同检测流程。
>
> 提交后请等待次日 06:00 的自动收录管道；收录成功会自动回复确认并关闭 issue。
