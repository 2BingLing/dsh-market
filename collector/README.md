# collector —— DSH Market 数据管道

每日抓取 DSH 插件生态数据，生成 `data/plugins.json`。

## 运行

```bash
cp ../.env.example .env   # 配置 GITHUB_TOKEN
npm run start -w collector
```

## 数据源

1. `topic:dsh-plugin` / `topic:deepseek-harness-plugin` GitHub 搜索
2. `dsh-external` 组织仓库
3. 人工策展 awesome 列表解析（0xsline / Alex-Yanggg）

## 处理流程

扫描 → 去重合并 → 仓库特征检测（SKILL.md / cordis 判定）→ 元数据抓取 → 实用五维评分 → 输出 `plugins.json`
