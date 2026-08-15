/**
 * 设置 GitHub 仓库 About 描述 + Topics
 * PATCH /repos/{owner}/{repo} → description
 * PUT  /repos/{owner}/{repo}/topics → names
 */
import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const token = env.match(/^GITHUB_TOKEN=(.+)$/m)?.[1];
if (!token) {
  console.error("no token");
  process.exit(1);
}

const OWNER = "2BingLing";
const REPO = "dsh-market";
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = {
  Authorization: `Bearer ${token}`,
  "User-Agent": "dsh-market",
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

// About 描述（homepage 单独设）
// 中英双语：GitHub About 为单字段，中文为主、英文附后
const description =
  "DeepSeek Harness 插件市场 · 持续收录 1500+ DSH 插件：中文搜索 + 实用五维评分 + 一键安装。Web 版与 DSH 侧边栏插件双形态。Plugin marketplace for DeepSeek Harness: 1500+ plugins, Chinese search, 5-dim scoring, one-click install.";

// Topics（GitHub 限制 ≤20 个，小写字母数字连字符）
// 全部切 DSH 生态要点：dsh 插件 / 市场 / dsh web；不用泛词（react/vite/open-source 无区分度）
const topics = [
  "dsh",
  "dsh-market",
  "dsh-plugin",
  "dsh-plugins",
  "dsh-web",
  "dsh-bundle",
  "dsh-skill",
  "deepseek-harness",
  "deepseek-harness-plugin",
  "deepseek-harness-plugins",
  "plugin-market",
  "plugin-marketplace",
  "plugin-registry",
  "plugin-search",
  "marketplace",
  "web",
];

async function main() {
  // 1. 更新 description + homepage
  const r1 = await fetch(BASE, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ description, homepage: "https://dsh.market/" }),
  });
  console.log("PATCH repo:", r1.status, r1.ok ? "ok" : await r1.text());

  // 2. 更新 topics
  const r2 = await fetch(`${BASE}/topics`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ names: topics }),
  });
  const j2 = await r2.json();
  console.log("PUT topics:", r2.status, r2.ok ? `-> ${(j2.names ?? []).join(", ")}` : JSON.stringify(j2));
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
