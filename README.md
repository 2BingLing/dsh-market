# DSH Market · DeepSeek Harness 插件市场

> 发现「实用、便捷」的 DSH 插件 —— 持续收录、实用五维评分、中文搜索、一键获取安装方式。

[在线体验](https://2bingling.github.io/dsh-market/) · [提交插件](https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md) · [评分体系说明](https://2bingling.github.io/dsh-market/)

## 这是什么

DeepSeek Harness（DSH）生态增长极快，插件分散在 GitHub 各处，**不知道哪个好用、怎么装**。DSH Market 解决这个问题：

- **持续收录**：每天自动扫描 `dsh-plugin` / `dsh` 等 GitHub topic、社区精选列表，全量收录
- **实用五维评分**：维护活跃 / 实用度 / 生态热度 / 便捷度 / 信号质量，加权几何平均融合，每个插件附「为什么推荐」的解释
- **中文体验**：所有插件自动生成中文简介和中文功能标签，中文搜索、中文筛选
- **安装引导**：每个插件详情页给出具体安装命令（一键复制）和「AI 安装提示词」（粘贴给 DSH 的 AI 即可自动安装）
- **发现体系**：高分精选 / 新手友好 / 最新上架分区、冷启动问卷推荐、标签多选 + 多维筛选

## 本地开发

```bash
git clone https://github.com/2BingLing/dsh-market.git
cd dsh-market
npm install
cp .env.example .env    # 填入 GITHUB_TOKEN（必需）、DEEPSEEK_API_KEY（可选，用于中文生成）

npm run collect         # 数据管道：扫描 → 检测 → 五维评分 → 中文化 → data/plugins.json
npm run dev -w web      # Web 站开发（http://localhost:5173）
npm run build -w web    # 生产构建
```

## 架构

```
GitHub Actions（每日 06:00 自动）
  ├─ collector：扫描 5 个 topic + 社区列表 → 特征检测 → 实用五维评分 → DeepSeek 中文化
  ├─ 提交数据 → 构建 → 部署 GitHub Pages
Web 站（纯静态，零服务器）
  ├─ 搜索 / 标签多选 / 多维筛选 / 分区推荐 / 冷启动问卷
  └─ 详情页：五边形雷达图 + 档案元数据 + 安装命令 + AI 安装提示词
DSH 插件端（开发中）
  └─ cordis 侧边栏插件：浏览 / 猜你喜欢 / 一键安装
```

## 路线图

- [x] M1 数据管道（收录 / 五维评分 / 缓存）
- [x] M2 Web 站（首页 / 详情 / 收藏 / 评分体系页）
- [x] M3 中文化（DeepSeek 批量生成中文简介与标签）
- [x] 发现体系（分区 / 问卷 / 标签面板 / 多维筛选）
- [x] M5 部署（Pages + 每日自动收录）
- [ ] M4 DSH 插件端（cordis 侧边栏 + 一键安装）

## License

MIT
