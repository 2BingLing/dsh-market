/**
 * 把 decay-scan 结果汇总到单个跟踪 issue（P0-D2 · 只报不删）
 * 读取 data/decay-report.json（collector/src/decay-cli.ts 产物）
 *  - 有失效条目 → 创建/更新（title 固定的）open issue，覆盖表格
 *  - 覆盖完整且无失效 → 若存在该跟踪 issue 则关闭（不再挂起）
 *  - 部分结果（限流中止/预算耗尽）→ 更新 issue 并**明确标注覆盖度**，绝不关闭
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

const KIND_ICON = { gone: "🕳️ 已删除", renamed: "🏷️ 已改名", archived: "🗄️ 已归档", forked: "🍴 已成 fork", dormant: "💤 长期停更", error: "⚠️ 探测失败" };

/**
 * 覆盖度是否完整。只有完整覆盖时，"0 条失效"才等价于"目录健康"，
 * 否则（限流中止/部分结果）必须拒绝关闭跟踪 issue——否则就是静默失败。
 */
function coverageComplete(report) {
  if (report.aborted) return false;
  if (report.probe?.rateLimited || report.probe?.budgetExceeded) return false;
  return true;
}

function buildBody(report) {
  const probe = report.probe;
  const coverage = probe
    ? `探测请求 ${probe.requests} 次 · 已核实 ${probe.resolved}/${report.checked} · 未覆盖 ${probe.unprobed}` +
      (probe.rateLimited ? " · ⚠️ 触发限流提前中止" : "") +
      (probe.budgetExceeded ? " · ⚠️ 预算耗尽提前中止" : "")
    : `检查 ${report.checked} 个已收录插件`;
  const partial = !coverageComplete(report)
    ? [
        "",
        `> ⚠️ **本轮为部分结果**（${report.abortedReason ?? "探测未完整覆盖"}）。`,
        "> 「未覆盖」的条目已标记为「探测失败」，**不代表它们健康**，需下轮复查。",
      ]
    : [];

  if (report.findings.length === 0) {
    return [
      coverageComplete(report) ? "## ✅ 本周无失效条目" : "## ⚠️ 本轮未完成有效扫描",
      "",
      `> ${coverage}。`,
      ...partial,
      "",
      coverageComplete(report)
        ? "本轮覆盖完整，目录健康，无需人工处置。"
        : "本轮未能完整覆盖，**不要据此认为目录健康**；下周一自动重扫。",
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
    `## ⚠️ 失效插件（需关注 ${report.findings.length}）`,
    "",
    `> 由 decay-scan 自动生成 · ${report.generatedAt} · ${byKind}`,
    `> ${coverage}`,
    ...partial,
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

  // DRY_RUN=1：只把将要提交的 issue 正文打到 stdout，不碰 GitHub（本地校验渲染用）
  if (process.env.DRY_RUN) {
    console.log(buildBody(report));
    console.log(`\n--- DRY_RUN · coverageComplete=${coverageComplete(report)} · findings=${report.findings.length} ---`);
    return;
  }

  // 查找已存在的跟踪 issue（按标题匹配，不限制 creator——actions bot 的 login 与 app slug 不一致）
  const list = await api(`/repos/${MARKET_REPO}/issues?state=all&per_page=100`);
  const existing = Array.isArray(list)
    ? list.find((i) => i.title === TITLE && !i.pull_request)
    : null;

  const body = buildBody(report);

  // 只有「覆盖完整 + 0 失效」才允许关闭跟踪 issue。
  // 部分结果（限流中止/预算耗尽）绝不能关闭——否则等于把"没扫到"当成"没问题"（旧版静默失败的根源）。
  if (report.findings.length === 0 && coverageComplete(report)) {
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
