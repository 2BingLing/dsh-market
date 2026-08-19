/**
 * 存量说明：给已 close 的提交插件 issue 补发「作者自述简介」功能介绍
 * 用法：
 *   node scripts/notify-author-intro.mjs            # 执行（发评论）
 *   node scripts/notify-author-intro.mjs --dry      # 预演（只列出目标，不发）
 */
import { readFileSync } from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN ?? readFileSync(".env", "utf8").match(/^GITHUB_TOKEN=(.+)$/m)?.[1];
const DRY = process.argv.includes("--dry");
const REPO = "2BingLing/dsh-market";

const NOTE = (fullName) =>
  [
    `> 📣 **说明** · DSH Market Bot`,
    ``,
    `你好！你的插件 \`${fullName}\` 已被 DSH Market 收录。`,
    ``,
    `现在市场支持 **作者自述简介**——在 \`dsh.market\` 插件详情页的「作者自述」专区，用你自己的话介绍插件（带作者标识，比自动生成的中文简介更有温度）。`,
    ``,
    `如需补写或修改：重新打开本 issue，或提交一个 \`[数据修正]\` issue，附上「**作者自述**：你的话」即可，次日更新生效。`,
  ].join("\n");

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
  if (!res.ok && res.status !== 404) throw new Error(`${path} -> ${res.status}`);
  return res.status === 404 ? null : res.json();
}

async function main() {
  if (!TOKEN) { console.error("缺少 GITHUB_TOKEN"); process.exit(1); }
  // 拉全部 closed 提交插件 issue
  const targets = [];
  const seen = new Set();
  for (let page = 1; page <= 4; page++) {
    const issues = await api(`/repos/${REPO}/issues?state=closed&per_page=100&page=${page}`) ?? [];
    if (issues.length === 0) break;
    for (const issue of issues) {
      if (seen.has(issue.number)) continue;
      seen.add(issue.number);
      if (issue.pull_request) continue;
      const isSubmission =
        (issue.labels ?? []).some((l) => l.name === "submission") ||
        /^\[提交插件\]|^\[Submit Plugin\]|^\[submit/i.test(issue.title);
      if (!isSubmission) continue;
      // 提取仓库（只对能提取到仓库的回复；纯说明也保留了仓库名）
      targets.push({ number: issue.number, title: issue.title });
    }
    if (issues.length < 100) break;
  }
  console.log(`找到 ${targets.length} 个已 close 的提交插件 issue`);
  if (DRY) {
    targets.forEach((t) => console.log(`  #${t.number} ${t.title.slice(0, 50)}`));
    console.log("DRY RUN：未发送。");
    return;
  }
  // 执行：防重复（已有「作者自述」说明的跳过）
  let sent = 0;
  for (const t of targets) {
    const comments = (await api(`/repos/${REPO}/issues/${t.number}/comments`)) ?? [];
    const already = comments.some((c) => (c.body ?? "").includes("作者自述简介"));
    if (already) { console.log(`#${t.number} 已有作者自述说明，跳过`); continue; }
    // 提取仓库名做个性化（匹配 body 里的 fullName）
    const issue = await api(`/repos/${REPO}/issues/${t.number}`);
    const m = (issue?.body ?? "").match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
    const fullName = m ? m[1] : (t.title.replace(/^\[[^\]]+\]\s*/, ""));
    await api(`/repos/${REPO}/issues/${t.number}/comments`, {
      method: "POST",
      body: { body: NOTE(fullName) },
    });
    sent++;
    console.log(`#${t.number} 已发送（${fullName}）`);
    await new Promise((r) => setTimeout(r, 800)); // 限流缓和
  }
  console.log(`完成：发送 ${sent} 条`);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
