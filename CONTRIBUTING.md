# 贡献指南（Contributing Guide）

感谢你关注 DSH Market —— DeepSeek Harness 插件市场。无论你是**插件作者**
想提交作品，还是**开发者**想改进项目，都欢迎。本文档说明两种贡献方式。

## 一、插件作者：提交插件

DSH Market 每日 06:00 自动扫描收录 DSH 生态插件，两种方式任选：

1. **打 topic（推荐，最快）**：给仓库打上 `dsh-plugin` topic，每日管道
   自动扫描命中（同时建议打 `deepseek-harness` / `dsh` 等生态 topic）。
2. **提交 issue**：使用[提交插件模板](https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md)
   创建 issue，填写仓库地址 / 插件类型 / 一句话简介。

**🎨 作者自述简介（可选但推荐）**：提交时填写的「作者自述简介」会展示在市场
**Web 详情页**的「作者自述」专区（带作者标识），用你自己的话介绍插件，比自动
生成的中文简介更有温度、更有说服力。已收录的插件想补写，可重新打开提交 issue
或提交一个 `[数据修正]` issue 附上作者自述，次日更新生效。

**提交后会发生什么**：

```
提交 → 次日 06:00 自动管道提取仓库 → 特征检测
  ├─ 通过（是 DSH 插件）→ 收录进市场 → issue 收到自动回复确认并关闭
  └─ 未通过（非插件）→ 不收录（issue 保持打开，可回复询问原因）
```

**收录条件**（全部满足）：

- 非 fork / 非归档 / 非 DSH 官方本体
- 特征检测通过：根目录有 `SKILL.md` 或 `skills/` 目录（skill 型）；
  `cordis.patch.yml` / `dsh.profile` 或 package.json 含 cordis 依赖（插件型）；
  插件成品在子目录的 bundle 仓库也可识别
- 建议打 `dsh-plugin` topic，让搜索索引尽快收录

**收录后可以**：

- 在 README 顶部挂[收录徽章](./PLUGIN-BADGE.md)（已收录 / 高分精选两档）
- 数据有误（安装命令 / 描述 / 评分）→ 提交 `[数据修正]` issue，
  说明仓库与问题，通常次日自动刷新

## 二、开发者：改进项目

### 本地环境

```bash
git clone https://github.com/2BingLing/dsh-market
cd dsh-market
npm install
# 数据管道：扫描 → 检测 → 评分 → 中文化 → data/plugins.json
npm run collect
# Web 站开发（localhost:5173）
npm run dev -w web
```

> `npm run collect` 需要 `GITHUB_TOKEN`（放根目录 `.env`）；
> 中文化可选，配置 `DEEPSEEK_API_KEY` 后启用。

### 代码结构

```
collector/   # 数据管道（Node + tsx）：扫描数据源 → 特征检测 → 五维评分 → 中文化
  src/sources/   # 数据源：topic 搜索 / awesome 列表 / 组织 / 提交 issue
  src/detect.ts  # 特征检测（SKILL.md / cordis 标记 / package.json）
  src/scoring.ts # 实用五维评分（维护/实用/热度/便捷/信号，几何平均）
web/         # Web 站（Vite + React + TS + Fuse.js）
plugin/      # DSH 插件版（core 纯 Node 核心 + ui cordis 插件）
schema/      # 共享类型（DshPlugin / MarketData / PracticalScore）
scripts/     # 工具脚本（回复 issue / 同步计数 / 截图 / 视觉检查）
```

### 测试

```bash
npm test -w collector   # collector 单测（vitest）
npm test -w plugin/core # 插件核心层单测（vitest）
```

改动涉及检测/评分/解析逻辑时，请补充对应单测。

### 提交规范

- commit message 用 `feat:` / `fix:` / `docs:` / `chore:` 前缀 + 中文简述
- 只提交与本次改动相关的文件；提交前检查 `git status` 暂存区
- 推送前先 `git pull --rebase`（每日管道会自动提交数据更新）

### 提 PR 流程

1. fork 仓库，从 `master` 新建分支
2. 完成改动 + 测试通过
3. 提交 PR，描述改动目的与验证方式
4. 维护者 review 后合并（数据管道改动会随每日部署生效）

## 三、其他贡献方式

- **数据修正**：发现插件信息有误 → 提交 `[数据修正]` issue
- **反馈建议**：普通问题直接用 issue 提问，不会自动关闭

## 行为准则

- 友好沟通，就事论事
- 尊重各插件作者的作品，不贬低他人插件

---

*DSH Market · DeepSeek Harness 插件市场 · [dsh.market](https://dsh.market/)*
