<div align="center">

# DSH Market

**DeepSeek Harness 插件市场** —— 持续收录 540+ 插件，中文搜索，实用五维评分，一键安装。

[![在线体验 Web 版](https://img.shields.io/badge/Web-%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-4D6BFE?style=flat-square&logo=githubpages&logoColor=white)](https://2bingling.github.io/dsh-market/)
[![提交插件](https://img.shields.io/badge/Contribute-%E6%8F%90%E4%BA%A4%E6%8F%92%E4%BB%B6-2EA043?style=flat-square)](https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://github.com/2BingLing/dsh-market/blob/main/LICENSE)
[![收录](https://img.shields.io/badge/%E6%94%B6%E5%BD%95-536%20%E6%8F%92%E4%BB%B6-4D6BFE?style=flat-square)](https://2bingling.github.io/dsh-market/)
[![更新](https://img.shields.io/badge/%E6%AF%8F%E6%97%A5%E8%87%AA%E5%8A%A8%E6%9B%B4%E6%96%B0-06%3A00-1a7f37?style=flat-square)](https://github.com/2BingLing/dsh-market/actions)

</div>

---

## 两种形态

DSH 生态增长极快，插件散落在 GitHub 各处 —— **不知道哪个好用、怎么装**。DSH Market 用一个平台收齐它们，并提供两种消费入口：

| | **Web 版**（已上线） | **DSH 插件版**（开发完成） |
|---|---|---|
| **位置** | 浏览器 · GitHub Pages 纯静态站 | DSH 侧边栏 · cordis 插件 |
| **定位** | 发现与评估 | 安装与管理 |
| **核心能力** | 中文搜索 · 五维评分雷达图 · 精选/最新分区 · 冷启动问卷 · 详情页安装命令 | 5-Tab 面板 · 一键安装（skill/cordis 双路由）· 猜你喜欢 · 场景推荐 · 已装管理 · GitHub 加星 |
| **安装** | 零安装，浏览器打开即用 | `dsh plugin --profile web add dsh-market` |
| **资源消耗** | — | 零 token 被动运行，不参与日常对话 |

> 两者读取**同一份** `plugins.json`（每日 06:00 自动刷新星星与描述），始终同步。

## 特性

- **持续收录** — 每天自动扫描 `dsh-plugin` / `dsh` 等 GitHub topic、社区精选列表，全量收录（当前 536 个）
- **实用五维评分** — 维护活跃 / 实用度 / 生态热度 / 便捷度 / 信号质量，加权几何平均融合，每个插件附「为什么推荐」解释
- **中文体验** — 所有插件自动生成中文简介与中文功能标签，中文搜索、中文筛选
- **一键安装** — 插件版确定性脚本路由：skill 型 `git clone`，cordis 型 `dsh plugin add`；失败可重试、可回滚
- **AI 安装** — 插件版可交给 DSH 子代理读 README 验证后安装，需要配置时先向你确认
- **推荐体系** — 高分精选 / 新手友好 / 猜你喜欢 / 场景推荐（读当前会话上下文），冷启动问卷
- **零 token 常驻** — 插件版纯被动运行，不打开面板不消耗任何资源

## 演示

| Web 版 | DSH 插件版 |
|---|---|
| ![Web 版截图](https://raw.githubusercontent.com/2BingLing/dsh-market/main/web/public/screenshot-web.jpg) | ![插件版截图](https://raw.githubusercontent.com/2BingLing/dsh-market/main/web/public/screenshot-plugin.jpg) |

## 快速开始

### Web 版

无需安装，直接访问：

<https://2bingling.github.io/dsh-market/>

### DSH 插件版

```bash
dsh plugin --profile web add dsh-market
```

装完**重启 harness**，侧边栏底部出现「插件市场」入口。

## 使用

### Web 版

| 场景 | 怎么用 |
|---|---|
| 找插件 | 搜索框中文关键词 / 标签多选 / 类型与评分筛选 |
| 看质量 | 卡片五边形雷达图 + 五维明细 + 推荐理由 |
| 装插件 | 详情页复制真实安装命令，或复制「AI 安装提示词」 |

### 插件版（5-Tab 面板）

| Tab | 做什么 |
|---|---|
| 推荐 | 猜你喜欢 / 精选 / 场景推荐（手动触发，读会话上下文） |
| 搜索 | 本地 Fuse 搜索 · 热门标签 · 200+ 结果分页 |
| 收藏 | 星标收藏的插件，稍后安装 |
| 已装 | 检测本机已装（skill 目录 + profile），一键卸载 |
| 设置 | GitHub 绑定（PAT 加星 / 设备流只读）· 推荐模式 · 目标 profile |

## 评分体系

实用五维（权重加权几何平均，借鉴 StarRadar 融合机制、理念转向「实用、便捷」）：

| 维度 | 权重 | 含义 |
|---|---|---|
| 维护活跃 | 30% | 近 90 天提交 + issue 健康度（DSH 迭代快，易坏的插件权重最高） |
| 实用度 | 25% | README / 文档 / 示例完备度 |
| 生态热度 | 20% | stars 对数归一化（p99 动态基准）+ fork 参与率（Wilson 小样本稳健） |
| 便捷度 | 15% | 安装步骤清晰 + 无需额外配置 |
| 信号质量 | 10% | license / topics / description / README 完备度 |

每个插件附 `explanation`（一句话解释评分理由）。详见 [评分体系说明](https://2bingling.github.io/dsh-market/)。

## 数据管道

```text
GitHub Actions（每日 06:00 自动收录 + 部署）
  └─ collector（Node，并发 10，24h 缓存）
       ├─ 扫描：dsh-plugin / dsh topic + awesome 列表 + dsh-external 组织
       ├─ 特征检测：SKILL.md / skills 目录 / cordis package.json
       ├─ 元数据 + README：GitHub API（stars / 描述 / 安装命令解析）
       ├─ 实用五维评分 + 解释层
       └─ DeepSeek 增量中文化（只翻译新插件，省 API 费用）
            → data/plugins.json
                 ├─ 同步到 web/public/plugins.json（Web 站 + 插件版共用）
                 └─ 提交 → 构建 → 部署 GitHub Pages
```

## 目录结构

```text
├─ collector/   # 数据管道（Node + tsx）：扫描 → 检测 → 评分 → 中文化
├─ web/         # Web 站（Vite + React + TS + Fuse.js）
├─ plugin/
│  ├─ core/     # 插件核心层（纯 Node，零 DSH 依赖，可独立测试）
│  └─ ui/       # 插件 UI 层（cordis Host RPC + 浏览器 Client 面板）
├─ schema/      # 共享类型（DshPlugin / MarketData / PracticalScore）
└─ scripts/     # 工具脚本（截图 / 数据注入 / 视觉评审）
```

## 本地开发

```bash
# 克隆与安装
git clone https://github.com/2BingLing/dsh-market.git
cd dsh-market
npm install
cp .env.example .env        # 填入 GITHUB_TOKEN（必需）、DEEPSEEK_API_KEY（可选）

# 数据管道（扫描 → 检测 → 评分 → 中文化 → data/plugins.json）
npm run collect

# Web 站
npm run dev -w web          # http://localhost:5173
npm run build -w web        # 生产构建

# 插件端
npm run build -w @dsh-market/core    # 核心层
npm run build -w @dsh-market/plugin  # 插件包（lib/index.js + lib/client.js）
```

## 贡献

- **提交插件**：通过 [issue 模板](https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md) 提交，每日管道自动收录
- **修正数据**：评分 / 描述 / 安装命令有误，提 issue 或 PR
- **开发**：见上方「本地开发」；设计决策记录见 `docs/`

## 路线图

- [x] M1 数据管道（收录 / 五维评分 / 缓存）
- [x] M2 Web 站（首页 / 详情 / 收藏 / 评分体系页）
- [x] M3 中文化（DeepSeek 批量生成中文简介与标签）
- [x] 发现体系（分区 / 问卷 / 标签面板 / 多维筛选）
- [x] M5 部署（Pages + 每日自动收录）
- [x] M4 DSH 插件端（cordis 侧边栏 + 一键安装）
- [ ] 语义搜索（LLM 选品精排，候选 60 → 精排 20，省 token 设计）
- [ ] 国内镜像（Vercel / Gitee Pages）

## FAQ

**Q：插件版会消耗 token 吗？**
不会。纯被动运行——不打开面板不消耗任何资源、不参与日常对话。唯一花费 token 的操作（AI 语义搜索、AI 代理安装）均为手动触发。

**Q：每日更新会刷新已收录插件的星星和描述吗？**
会。每日 06:00 管道重新抓取全部 repo 元数据（stars / 描述 / README / 安装命令），大改次日即反映。

**Q：插件版会下载 Web 端吗？**
不会。插件只拉取 `plugins.json`（约 1.3MB 纯数据），安装的是插件本体。

**Q：Web 和插件版数据一致吗？**
完全一致。两者读取同一份 `plugins.json`。

## License

[MIT](https://github.com/2BingLing/dsh-market/blob/main/LICENSE)
