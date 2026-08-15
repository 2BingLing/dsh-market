/**
 * 自动回复提交插件 issue：读取 data/issue-replies.json（collector 产物）
 * 对每个已收录插件的 issue：评论"已收录" + 挂 label + 关闭
 * 权限：需要 GITHUB_TOKEN（issues: write）
 *
 * 用法：node scripts/reply-issues.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPLIES_FILE = join(here, "../data/issue-replies.json");
const MARKET_REPO = "2BingLing/dsh-market";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

function buildReply(r) {
  const listedUrl = `https://2bingling.github.io/dsh-market/?q=${encodeURIComponent(r.fullName)}`;
  const badgeDoc = "https://github.com/2BingLing/dsh-market/blob/main/PLUGIN-BADGE.md";
  return [
    `> ⚙️ **自动回复** · DSH Market Bot`,
    ``,
    `✅ **已收录** \`${r.fullName}\`（${r.type === "skill" ? "skill" : "cordis 插件"}${r.score ? ` · 实用分 ${r.score}` : ""}）`,
    ``,
    `- 数据已进入市场，**次日 06:00 更新**后可在 [DSH Market](https://2bingling.github.io/dsh-market/) 搜索到（${listedUrl}）。`,
    `- 你的仓库本身无需任何改动；如果还没有打 \`dsh-plugin\` topic，建议打上，便于持续被发现。`,
    `- 可选：在插件 README 顶部挂 [DSH Market 收录徽章](${badgeDoc})（已收录 / 高分精选两档）。`,
    ``,
    `> 本 issue 已自动关闭。如有问题（简介/评分/安装命令有误）欢迎重新打开或提交新 issue。`,
  ].join("\n");
}

async function api(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "User-Agent": "dsh-market-bot",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`API ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 404 ? null : res.json();
}

async function main() {
  if (!TOKEN) {
    console.error("缺少 GITHUB_TOKEN");
    process.exit(1);
  }
  // 先读当前收录数据，核对仓库确实已收录才回复（双保险，避免误报）
  let collectedIds = new Set();
  try {
    const market = JSON.parse(readFileSync(join(here, "../data/plugins.json"), "utf8"));
    collectedIds = new Set(market.plugins.map((p) => p.id.toLowerCase()));
  } catch {
    console.warn("无法读取 data/plugins.json，跳过本次回复（下次部署重试）");
    return;
  }

  let replies;
  try {
    replies = JSON.parse(readFileSync(REPLIES_FILE, "utf8")).replies ?? [];
  } catch {
    console.log("无 issue-replies.json（collector 未生成）");
    return;
  }
  if (replies.length === 0) {
    console.log("无待回复的 issue");
    return;
  }

  for (const r of replies) {
    // 条件 1：仓库必须已收录（否则不回复，保持静默）
    if (!collectedIds.has(r.fullName.toLowerCase())) {
      console.warn(`跳过 ${r.fullName}：不在当前收录数据中（未收录，保持静默）`);
      continue;
    }
    for (const issueNumber of r.issueNumbers) {
      // 防重复回复：检查是否已有 bot 评论
      const comments = await api(`/repos/${MARKET_REPO}/issues/${issueNumber}/comments`);
      const already = (comments ?? []).some((c) => (c.body ?? "").includes("已收录"));
      if (already) {
        console.log(`#${issueNumber} 已回复过，跳过`);
        continue;
      }
      // 评论
      await api(`/repos/${MARKET_REPO}/issues/${issueNumber}/comments`, {
        method: "POST",
        body: { body: buildReply(r) },
      });
      console.log(`#${issueNumber} 已评论（${r.fullName}）`);
      // 挂 label
      await api(`/repos/${MARKET_REPO}/issues/${issueNumber}/labels`, {
        method: "POST",
        body: { labels: ["submission", "accepted"] },
      }).catch((e) => console.warn(`#${issueNumber} label 失败: ${e.message}`));
      // 关闭
      await api(`/repos/${MARKET_REPO}/issues/${issueNumber}`, {
        method: "PATCH",
        body: { state: "closed" },
      });
      console.log(`#${issueNumber} 已关闭`);
    }
  }
  console.log("完成");
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
