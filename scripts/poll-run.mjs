/**
 * 轮询 workflow run 状态（带重试），直到完成或失败
 * 用法：node scripts/poll-run.mjs <runId>
 */
import { readFileSync } from "node:fs";

const token = readFileSync(".env", "utf8").match(/^GITHUB_TOKEN=(.+)$/m)?.[1];
const runId = process.argv[2];
if (!runId) {
  console.error("用法: node scripts/poll-run.mjs <runId>");
  process.exit(1);
}

async function api(path) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "dsh-market", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(25000),
      });
      return await r.json();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
let lastStatus = "";

for (;;) {
  const j = await api(`/actions/runs/${runId}`);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const status = `${j.status}${j.conclusion ? "/" + j.conclusion : ""}`;
  if (status !== lastStatus) {
    console.log(`[${elapsed}s] run: ${status}`);
    lastStatus = status;
  }
  if (j.status === "completed") {
    // 输出失败步骤
    if (j.conclusion === "failure") {
      const jobs = await api(`/actions/runs/${runId}/jobs`);
      for (const job of jobs.jobs || []) {
        for (const s of job.steps || []) {
          if (s.conclusion === "failure") console.log(`❌ 失败步骤: ${s.number} ${s.name}`);
        }
      }
    } else {
      console.log(`✅ 完成: ${j.conclusion}`);
    }
    break;
  }
  await sleep(30000);
}
