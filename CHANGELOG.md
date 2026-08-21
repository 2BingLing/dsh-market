# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格。标题按版本号与日期排序，最新在上。

## [0.3.1] - 2026-08-21

### 插件端（`@dsh-market/plugin` / `@dsh-market/core`）

**修复：已装 Tab 无法识别带 scope 的 npm 包（issue #56）**
- `scanInstalled` 匹配对 `@scope/pkg` 归一化：`pkg` 对齐仓库名 `name`、`scope/pkg` 对齐 `owner/repo`（GitHub owner 大小写不敏感）。
- 复现例 `@nanmicoder/dsh-agent-teams`（仓库 `NanmiCoder/dsh-agent-teams`）此前落入「未收录市场」且「检查更新」失效 → 现在正确归属「已安装」并可检测更新。
- 新增 `plugin/core/test/installed.test.ts`（7 用例）。

**改进：插件自身更新改「引导式」（不再运行中就地执行）**
- `update:self` 的 apply 不再在 harness 运行中执行 `dsh plugin add`（Windows 上覆盖自己必卡），改为返回 `needsManual + manualCommand`；
- 面板「获取命令」按钮：复制停 harness 后的命令行并提示，杜绝「更新中」卡死。

## [0.3.0] - 2026-08-21

PoC 落地：装后生效验证、构建脚本放行、假更新防误报、周度失效扫描(**P0**)。

### 插件端（`@dsh-market/plugin` / `@dsh-market/core`）

**新增：装后四态生效验证（verify）**
- 安装/更新后读取 profile 真值 `dsh.profile.bundles` + 已装包 `dsh.bundle`/`dsh.client` 声明 + `cordis.patch.yml` 现状，判定 `live / restart / inert / broken` 四态并附原因与建议动作。
- 「已装」Tab 新增**「验证」按钮**与四态徽标（已生效/重启后生效/未成为插件层/校验失败）。

**新增：构建脚本放行（builds）**
- 解析 pnpm `Ignored build scripts:` 被拦包名 → 按 pnpm 主版本自动选键（≥11 `allowBuilds` map / 10 `onlyBuiltDependencies` 数组）→ **增量合并**写 `<profile>/pnpm-workspace.yaml`（保留原内容）。
- 更新/安装失败时识别构建被拦 → 自动放行并重试一次。

**新增：假更新防误报（update）**
- 更新改为 `update:apply`：更新前后真实版本 / HEAD commit 对比，杜绝"点了更新版本没动却显示成功"。
- 被 pnpm `minimumReleaseAge` 发布年龄门槛挡住时给出原因，并提供「放宽门槛（0）并重试」。
- skill 目标用 HEAD commit 而非时间戳判定"上游无新提交"。

**修复：运行中 profile 的安装/卸载/更新卡死**
- 识别 `EPERM / EBUSY / 文件被占用` 类失败并**立即失败、不再重试**（此前最多 3×180s 假死），并提示"请先停止 harness 或改用未运行的 profile"。

**内部：**
- 核心层新增导出：`verify.ts`（装后验证）、`builds.ts`（构建放行）、`yaml-block.ts`（pnpm-workspace.yaml 行级增量编辑）、`applyUpdate / readMinimumReleaseAge / writeMinimumReleaseAge`。
- `fetch` 缓存键按 fetch 实例隔离（修复测试注入时的跨用例缓存污染；生产行为不变）。
- RPC 新增：`verify`、`update:apply`、`update:relax`、`builds:approve`（向后兼容，仅新增）。

### 数据管道（仓库内，未发布 npm）

**新增：decay-scan 失效条目扫描（只报不删）**
- 每周一扫描已收录插件：仓库消失 / 归档 / 变 fork / 长期停更（默认 270 天）→ 汇总到单个跟踪 issue「🗑️ 失效插件周报（只报不删）」，全部健康则自动关闭。
- 新增 `collector/src/decay.ts`、`decay-cli.ts`、`.github/workflows/decay-scan.yml`、`scripts/decay-report-issue.mjs`。

## [0.2.1] - 早期版本

插件端基础能力：5-Tab 面板（推荐/搜索/收藏/已装/设置）、一键安装（skill/cordis 路由 + 快照回滚）、更新检测、场景推荐、AI 代理安装、GitHub 绑定加星；collector 每日收录 + 五维评分 + 中文化。
