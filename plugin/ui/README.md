# @dsh-market/plugin

DSH Market 的**插件端**：装进 DeepSeek Harness 侧边栏的插件市场 —— 浏览 / 搜索 / 猜你喜欢 / 一键安装 / 已装管理。

> 只想逛不想装？Web 版免安装：<https://dsh.market/>

---

## 环境要求

| 依赖 | 要求 |
|---|---|
| **DSH（DeepSeek Harness）** | **≥ 0.0.1-rc.5** |
| Node.js | ≥ 20 |

### 面板入口按 DSH 版本自动切换

本包**单一产物同时兼容两代 DSH**，不需要按版本换装：

| DSH 版本 | 面板入口 |
|---|---|
| **≥ 0.1.5-rc.1** | 标准入口 `sidebar.panellist` + `main` —— 图标进左侧导航栏，面板在中央列展开 |
| **< 0.1.5** | 旧入口 `sidebar.footer.action` + `shell.overlay` —— 侧边栏底部按钮 + 居中浮层 |

判定方式是运行时探测 `layout.selectPanel`（0.1.5 新增；旧版 `layout` 服务只有 `attachPanels` / `toggleSidebar` / `openDetails` / `closeDetails`）。两代都 `provide('layout')`，所以既不会误判，也不会因等待服务而挂死。

### 版本依据

- **最低 `0.0.1-rc.5`** —— 四项前提已逐版核对：客户端模块系统解析 `dsh.client`、`sidebar.footer.action` + `shell.overlay` 的 slot 契约、`layout` 服务、`webServer.register({ kind: 'prefix' })` 签名。更早版本未核对。
- **实测运行** —— `0.1.1-rc.2`（旧入口）、`0.1.5-rc.1`（标准入口）。
- **推荐 `≥ 0.1.5-rc.1`** —— 标准面板入口与新版能力完整可用。

## 安装

```bash
npx @deepseek-ai/dsh plugin --profile web add @dsh-market/plugin
```

装完**重启 harness** 生效（插件层在启动时合成）。

## 使用

重启后按你的 DSH 版本找到入口：新版在**左侧导航栏**，旧版在**侧边栏底部**（齿轮旁）。面板含 5 个 Tab：推荐 / 搜索 / 整合包 / 收藏 / 已装。

- **零 token 被动运行** —— 不打开面板不消耗任何资源，不参与日常对话
- **一键安装** —— skill / cordis 自动路由，失败可重试、可回滚
- **AI 代理安装（路由模式）** —— 先走零 LLM 直装（已装检测 → 配方缓存 → README 解析命令 + 冒烟验证），需要时才派极简协议子代理；成功即学习配方，重装零 token
- **🛡 安全模式**（确认安装时可勾选）—— 跳过直装，强制 AI 子代理先做供应链扫描（危险命令 / 敏感信息外发 / 配置篡改 / 来源存疑），发现风险即中止

## 首次打开的加载时间

面板数据来自市场索引 `plugins.json`（当前约 6175 个插件，**原始约 12.5 MB，gzip 传输约 2.8 MB**）。

**每个 DSH 进程的首次打开**需要完整拉取该索引，实测耗时 **约 6–8 秒**（TTFB ~2.2s + 传输 ~4–6s；`JSON.parse` 仅 ~70ms，不是瓶颈）。同进程内会复用内存缓存，之后的打开是即时的；**重启 DSH 后首次打开会再次等待**。

原因：宿主侧取数是**远程优先**（15s 超时），磁盘缓存目前只在远程失败时兜底 —— 即使本地已有缓存，每次进程启动仍会重新下载整份索引。此外面板实际只用其中 15 个字段（约合 3.1 MB 原始 / 0.81 MB gzip），其余约 71% 的传输量未被使用。

## 相关

- 仓库与完整说明：<https://github.com/2BingLing/dsh-market>
- 数据源：<https://2bingling.github.io/dsh-market/plugins.json>

## License

MIT
