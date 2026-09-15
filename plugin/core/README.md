# @dsh-market/core

DSH Market 插件端核心层：纯 Node 模块，零 DSH API 依赖（数据 / 搜索 / 画像 / 推荐 / 安装），可独立测试。

`@dsh-market/plugin`（侧边栏插件）的运行时依赖，也可独立使用。

## 能力一览

- **数据** — 拉取市场索引（全量 `plugins.json` / 瘦身 `plugins-lite.json`），stale-while-revalidate 磁盘缓存
- **搜索与推荐** — 中文搜索（Fuse.js）、新手友好 / 个性化 / 场景推荐
- **已装管理** — 扫描 skill 目录与 profile 依赖、更新检查（含 pnpm minimumReleaseAge 联动）
- **路由安装（T0）** — 已装检测 → 配方缓存 → README 解析命令 → 内置确定性安装；带结构化冒烟验证、快照与回滚
- **🛡 命令安全门** — T0 直装命令白名单（#165）：只放行 `dsh plugin add`、克隆插件自身仓库、非全局 registry 安装三类受限形态；管道执行远端脚本、全局安装、链式/重定向等一律拦截并升级 AI 复核，绝不原样执行
- **配方沉淀** — 安装成功自动学习命令 + 冒烟检查，重装零 token；带环境指纹与新鲜度
- **兼容门禁** — 解析 `engines.dsh` 与本地 DSH 版本比对
- **诊断** — 错误分类、操作日志、安装度量

## 安装

```bash
npm install @dsh-market/core
```

## 安全模型

宿主进程注入的 `runner` 以用户权限执行命令，因此 T0 直装路径内置命令白名单（`guardInstallCommands`）：
黑名单挡不完供应链攻击，白名单只放行结构受限、可预期的形态，其余一律拒绝直装并升级 AI 复核。
详见仓库 `plugin/core/src/command-guard.ts` 与 issue #165。

## License

MIT
