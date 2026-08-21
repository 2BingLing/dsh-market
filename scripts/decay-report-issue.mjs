/**
 * 把 decay-scan 结果汇总到单个跟踪 issue（P0-D2 · 只报不删）
 * 读取 data/decay-report.json（collector/src/decay-cli.ts 产物）
 *  - 有失效条目 → 创建/更新（title 固定的）open issue，覆盖表格
 *  - 全部健康    → 若存在该跟踪 issue 则关闭（不再挂起）
 * 权限：GITHUB_TOKEN（issues: write）
 * 用法：node scripts/decay-report-issue.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = join(here, "../data/decay-report.json");
const MARKET_REPO = "2BingLing/dsh-market";
const TITLE = "🗑️ 失效插件周报（只报不删）";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

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

const KIND_ICON = { gone: "🕳️ 已删除", archived: "🗄️ 已归档", forked: "🍴 已成 fork", dormant: "💤 长期停更", error: "⚠️ 探测失败" };

function buildBody(report) {
  if (report.findings.length === 0) {
    return [
      "## ✅ 本周无失效条目",
      "",
      `> 检查 ${report.checked} 个已收录插件，全部健康。`,
      "",
      "从上次" + TITLE + "起一切正常，无需人工处置。",
    ].join("\n");
  }
  const rows = report.findings
    .map((f) => {
      const icon = KIND_ICON[f.kind] ?? f.kind;
      const day = f.days !== null ? `${f.days} 天` : "—";
      return `| ${icon} | [${f.fullName}](https://github.com/${f.fullName}) | ${f.detail} | ${f.stars} | ${day} |`;
    })
    .join("\n");
  const byKind = Object.entries(report.byKind)
    .map(([k, n]) => `${KIND_ICON[k] ?? k} ${n}`)
    .join(" · ");
  return [
    `## ⚠️ 失效插件（检查 ${report.checked}，需关注 ${report.findings.length}）`,
    "",
    `> 由 decay-scan 自动生成 · ${report.generatedAt} · ${byKind}`,
    "",
    "**原则：扫描只报不删。** 以下条目已失效或停更，请人工在 [DSH Market](https://dsh.market/) 检视后决定「保留历史」还是「从市场移除」；确认移除后可直接改数据或开 [数据修正](https://github.com/2BingLing/dsh-market/issues) issue。",
    "",
    "| 形态 | 仓库 | 说明 | Stars | 停更 |",
    "|---|---|---|---|---|",
    rows,
    "",
    "> 下周一自动刷新此列表。",
  ].join("\n");
}

async function main() {
  if (!TOKEN) {
    console.error("缺少 GITHUB_TOKEN");
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(REPORT_FILE, "utf8"));
  } catch (err) {
    console.error(`读取 ${REPORT_FILE} 失败（先运行 decay-cli）。${err.message}`);
    process.exit(0); // 无报告不打扰
  }

  // 查找已存在的跟踪 issue（按标题匹配，不限制 creator——actions bot 的 login 与 app slug 不一致）
  const list = await api(`/repos/${MARKET_REPO}/issues?state=all&per_page=100`);
  const existing = Array.isArray(list)
    ? list.find((i) => i.title === TITLE && !i.pull_request)
    : null;

  const body = buildBody(report);

  if (report.findings.length === 0) {
    // 全部健康：若跟踪 issue 正开着就关闭（不留挂起）
    if (existing && existing.state === "open") {
      await api(`/repos/${MARKET_REPO}/issues/${existing.number}`, {
        method: "PATCH",
        body: { body, state: "closed" },
      });
      console.log(`closed tracking issue #${existing.number}`);
    } else {
      console.log("no findings & no open tracking issue → no-op");
    }
    return;
  }

  if (existing) {
    await api(`/repos/${MARKET_REPO}/issues/${existing.number}`, {
      method: "PATCH",
      body: { body },
    });
    // 若曾被关闭则重开
    if (existing.state !== "open") {
      await api(`/repos/${MARKET_REPO}/issues/${existing.number}`, {
        method: "PATCH",
        body: { state: "open" },
      });
    }
    console.log(`updated tracking issue #${existing.number} (findings: ${report.findings.length})`);
  } else {
    const created = await api(`/repos/${MARKET_REPO}/issues`, {
      method: "POST",
      body: { title: TITLE, body },
    });
    console.log(`created tracking issue #${created.number} (findings: ${report.findings.length})`);
  }
}

main().catch((err) => {
  console.error("decay-report-issue failed:", err);
  process.exit(1);
});
