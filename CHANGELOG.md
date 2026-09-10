# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格。标题按版本号与日期排序，最新在上。

## [0.4.7] - 2026-09-10

### 插件端（`@dsh-market/plugin@0.4.7` / `@dsh-market/core@0.4.6`）

修「打开面板要等 6–8 秒」：**有过期缓存时前台 59ms 返回**（旧实现同场景要重下整份索引，实测 8461ms），冷启动传输量降 56%。

**修复：磁盘缓存写了却从不读（首次打开的 6–8 秒等待）**
- `fetchMarketData` 是**远程优先**，磁盘缓存只在远程失败时兜底 —— 于是每个 DSH 进程首次打开面板都要重新下载整份索引。缓存设施（`writeCache`/`readCache`/`cacheAge`/`cacheTtlMs`）其实早已就绪，但 `readCachedData` **在生产代码里没有任何调用点**（只有它自己的定义和一个单测引用）。等于读路径从未接线。
- 新增 `loadMarketData()`（stale-while-revalidate）并接入插件宿主：未过期缓存直接返回、**不发网络请求**；过期缓存立即返回旧数据 + 后台刷新（下次打开即最新）；无缓存才前台等。实测过期缓存场景前台 **59ms** 返回。`data` RPC 新增 `stale`/`ageMs` 便于 UI 提示。
- 远程地址记忆从模块级变量改为按 cfg 的 `WeakMap`，避免不同数据源/测试之间互相污染。

**新增：瘦身索引 `plugins-lite.json`（冷启动传输 -56%）**
- 全量索引已达 12.49 MB 原始 / **2.79 MB gzip**，而插件端只读取其中一部分字段。新增 `core/lite.ts` 的裁剪投影，collector 额外产出 `plugins-lite.json`：**4.17 MB 原始 / 1.20 MB gzip（原始 -66%、gzip -56%）**。
- 裁剪判据不是拍脑袋：对 `plugin/core/src`、`plugin/ui/src`、`schema/src` 逐字段做 `.字段名` 属性访问扫描（剔除注释），**零访问**的字段才裁剪（`readmeSummary` 一项就占全量 17.4%，另有 `topics`/`score.breakdown`/`score.explanation`/`createdAt`/`updatedAt`/`repo`/`language` 等）。
- **漂移安全网**：`core/test/lite.test.ts` 用等价性测试锁死 —— 同一批插件分别喂全量与瘦身数据，`recommend()` 与 `search()` 的结果（含 relevance / tagHits / reasons）必须逐项一致。将来谁新读了被裁字段，测试立刻变红。
- **上线顺序安全**：插件端**优先取 lite、404 自动回退全量**，所以在数据管道尚未产出该文件时不会把插件打挂；命中的地址按 cfg 记忆，不会每次重撞 404。
- 顺带修正 `fetchPacksData` 的地址推导：旧写法 `replace(/plugins\.json/)` 在 lite 地址上不命中，会去把 `plugins-lite.json` 当成 packs 拉。

**修复：`plugin/ui` 的类型检查一直校验的是已发布的旧 core**
- `node_modules/@dsh-market/core` 存在一份 registry 实体副本（0.4.2，早期 `plugin/core` 版本低于 `^0.4.0` 时 npm 嵌套所致），**遮蔽了工作区链接** —— 于是 `plugin/ui` 的 typecheck 从未真正校验本地 core 源码。已清理该嵌套副本与 lockfile 中对应条目，现解析到 `plugin/core/dist`。
- 运行时不受影响（profile 里是 junction，本来就指向本地）；仅类型检查失真。

**构建/CI**
- `plugin/core/dist` 被 `.gitignore` 忽略，而 CI 是 `npm ci` → `npm run collect`、无构建步骤；collector 现在运行时依赖 core 的构建产物，故 workflow 显式补上 `npm run build -w @dsh-market/core`（否则 collect 会以找不到模块失败、当日无数据更新）。
- workflow 同步 `plugins-lite.json` 到 `web/public` 并纳入 `git add`。

**文档**
- 补齐**最低 DSH 版本要求**（原先 README 完全没写）：`README.md` 新增 `## 环境要求`、`README.en.md` 新增 `## Requirements`。
- 新建 `plugin/ui/README.md` —— 该文件原先不存在（`files` 里列着它），导致 npm 包页面一直空白。

## [0.4.6] - 2026-09-10

### 插件端（`@dsh-market/plugin@0.4.6` / `@dsh-market/core@0.4.5`）

适配 DSH 0.1.5：**同一份产物同时兼容 ≤0.1.4 与 0.1.5+**，新版走标准面板入口，旧版行为不变。

**新增：双路面板入口 —— 新版走标准入口，旧版保持原样（同一份产物）**
- client half 按宿主能力探测后二选一注册，互斥：
  - **0.1.5+**（`layout.selectPanel` 存在）→ `sidebar.panellist`（左栏导航图标）+ `main`（中央面板，`key` 与 panellist 的 `id` 同名 `dsh-market`）。这就是 0.1.5 更新日志所说的「面向插件作者的标准化 web ui 扩展入口」。
  - **≤0.1.4**（layout 只有 `attachPanels/toggleSidebar/openDetails/closeDetails`）→ `sidebar.footer.action` + `shell.overlay`，行为与升级前完全一致。
- 探测点选 `layout.selectPanel`：两代 `root` slot 的子节点也不同（旧版 `conversation`/`details`，新版 `main`/`rightbar`），若只看 slot 名会误判；`selectPanel` 是 0.1.5 独有的方法，判据干净。`inject` 增加 `layout`，保证探测时它已就绪（两代都 `provide('layout')`，不会把插件挂死在等待上）。
- `MarketPanel` 增加 `mode: 'overlay' | 'main'`：main 模式嵌进中央列（无遮罩、卡片填满、`onClose` → `layout.selectPanel(null)` 回对话），overlay 模式保持原居中模态。原有 `if (!open) return null` 与各 `useEffect` 的 `open` 依赖在两代都成立（main 模式由 layout 决定挂载，恒为打开）。
- 新增 `plugin/ui/test/client-dual-path.mjs`：直接加载构建产物 `lib/client.js`，用两代假 ctx 各 apply 一次，断言注册的 slot 名、`panellist.id === main.key`（契约硬约束，对不上点击会抛错）、两路互斥、layout 缺失时安全降级、以及 bundle 未引入 `react` 以外的外部模块。`plugin/ui` 的 `npm test` 已接入（`pretest` 先构建）。

**修复：场景推荐丢失会话标题（0.1.5 上的静默退化）**
- `sessionQuery.readTitle()` 在 0.1.5 改为**直接返回标题字符串**（旧版返回 `{ title }`）。原写法 `t?.title ?? ''` 在字符串上取 `.title` 恒为 `undefined`，导致「猜你喜欢」的标题信号永久丢失且不报错。现按两种形态兼容取值。

**修复：安全模式（`ai:install` + `security: true`）必崩**
- 该分支跳过 T0 时 `t0` 为 `null`，而度量上报里写的是 `t0.reason` → `TypeError`。已改为 `t0?.reason`（同函数下方本就用可选链）。

**改进：子代理归属改用 `agents.roots()`**
- 0.1.5 起 `agents.list()` 含可继续对话的子代理，`list()[0]` 可能取到子代理；`roots()` 只返回顶层 agent。两处调用点改为 `roots?.() ?? list?.() ?? []`（旧版无 `roots` 时自动回退，向后兼容）。

**清理：过时/失效的插件元数据与构建外部清单**
- `package.json`：移除顶层 `dshClient` 字段——DSH 的 `parseDshClient` 只读 `pkg.dsh.client`（0.1.0-rc.8 / 0.1.1-rc.2 / 0.1.5-rc.1 三版均已核对），该字段从未被读取。
- `package.json`：`dsh.client.inject` 由 `[dsh-client-runtime, dsh-client-locale, dsh-client-ui-slots]` 清空——这两个包在 0.1.5 已不存在（旧版也从不消费该字段），插件的 client bundle 实际只 `require("react")`。
- `tsdown.config.ts`：外部清单对齐 0.1.5 壳层真实静态种子表（`react*` / `@deepseek-ai/cordis` / `dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-primitives` / `dsh-client-ui-dockkit`），移除已消失的 `dsh-client-runtime` 与 `dsh-client-web-react`，裸 `cordis` 改为 `@deepseek-ai/cordis`。

**改进：市场插件判定不再认 `dshClient`**
- `collector`：`isCordisPackageJson` 移除 `dshClient` 分支——只有该字段的包在 DSH 上不会被加载，列为可用插件属误报（同时含 `dsh.bundle.patch` 或 cordis 依赖的仓库仍照常命中）。
- `core/verify`：装后四态验证的 `hasClient` 只认 `dsh.client`；仅有 `dshClient` 的包不再被判成 `restart`（"重启后生效"），而是 `inert` 并明确提示「旧版声明字段，装上不会生效」。
- 新增测试：`collector/test/detect.test.ts`、`plugin/core/test/verify.test.ts` 各补一例锁定新语义。

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
