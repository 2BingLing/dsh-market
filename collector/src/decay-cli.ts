/**
 * 失效条目扫描 CLI（P0-D2）
 * 用法：node --import tsx collector/src/decay-cli.ts
 * 读取 data/plugins.json → GraphQL 批量探测（100 仓库/请求）→ 只报不删 → 写 data/decay-report.json
 * 手工通道：每周 workflow 调用，结果汇总到跟踪 issue（scripts/decay-report-issue.mjs）
 *
 * 2026-09-12 修复：原逐仓库 REST 探测（5572 次请求）撞配额后 githubFetch 会 sleep 重试，
 * 导致每周一 job 卡满 40 分钟被 cancel、报告从不产出。改为 GraphQL 批量（约 56 次请求），
 * 并在 finally 里**无条件写报告**——哪怕探测层整体失败，也要让跟踪 issue 反映真实覆盖度。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./env.js"; // 加载仓库根 .env（GITHUB_TOKEN）
import type { MarketData } from "@dsh-market/schema";
import { scanDecay, type DecayReport } from "./decay.js";
import { batchProbeRepos, DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENCY, DEFAULT_BUDGET_MS } from "./decay-probe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const REPORT_PATH = join(DATA_DIR, "decay-report.json");

async function main() {
  const raw = readFileSync(join(DATA_DIR, "plugins.json"), "utf8");
  const market = JSON.parse(raw) as MarketData;
  console.log("=== DSH Market · 失效条目扫描（只报不删）===");
  console.log(`  收录 ${market.plugins.length}，开始批量探测…（GraphQL ${DEFAULT_BATCH_SIZE} 仓库/请求）`);

  const t0 = Date.now();
  let report: DecayReport | null = null;

  try {
    const fullNames = market.plugins.map((p) => p.fullName);
    const probe = await batchProbeRepos(fullNames, {
      batchSize: Number(process.env.DECAY_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
      concurrency: Number(process.env.DECAY_CONCURRENCY) || DEFAULT_CONCURRENCY,
      budgetMs: Number(process.env.DECAY_BUDGET_MS) || DEFAULT_BUDGET_MS,
      onProgress: (done, total, s) => {
        const el = Math.round((Date.now() - t0) / 1000);
        console.log(`  [进度] ${done}/${total}，请求 ${s.requests} 次，未覆盖 ${s.unprobed}，已用 ${el}s`);
      },
    });

    const s = probe.stats;
    console.log(
      `  探测完成：请求 ${s.requests} 次（REST 逐仓库需 ${s.total} 次）· 解析 ${s.resolved} · 判定消失 ${s.notFound} · 未覆盖 ${s.unprobed}` +
        (s.rateLimited ? " · ⚠️ 触发限流提前中止" : "") +
        (s.budgetExceeded ? " · ⚠️ 预算耗尽提前中止" : "") +
        ` · 剩余配额 ${s.rateLimitRemaining ?? "?"} · 用时 ${Math.round(s.elapsedMs / 1000)}s`,
    );

    // 未覆盖的仓库：让 fetchRepo 抛错 → 归入 error（需下轮复查），绝不假装健康
    const probeRepo = async (fullName: string) => {
      if (!probe.map.has(fullName)) {
        throw new Error("本轮未覆盖（限流/预算/批失败），需下轮复查");
      }
      return probe.map.get(fullName) ?? null;
    };

    report = await scanDecay(market, {
      fetchRepo: probeRepo,
      concurrency: Number(process.env.DECAY_SCAN_CONCURRENCY) || 8,
      // 批量探测的 error 是瞬间产生的，不存在"挂死"风险 → 关掉熔断，
      // 保证"未覆盖的条目也如实标 error"，覆盖度在报告里一目了然
      abortOnErrors: false,
      budgetMs: Number(process.env.DECAY_BUDGET_MS) || DEFAULT_BUDGET_MS,
      onProgress: (done, total, errs) => {
        const el = Math.round((Date.now() - t0) / 1000);
        console.log(`  [判定] ${done}/${total}，累计异常 ${errs}，已用 ${el}s`);
      },
    });

    // 始终带上探测覆盖度（跟踪 issue 会展示，顺便让"用 64 次请求替代 6358 次"这件事可见）
    {
      report.probe = {
        requests: s.requests,
        resolved: s.resolved,
        unprobed: s.unprobed,
        rateLimited: s.rateLimited,
        budgetExceeded: s.budgetExceeded,
      };
    }
  } catch (err) {
    console.error(`  探测层整体失败：${(err as Error).message}`);
    // 降级：只做「本地可得」的判定（用 plugins.json 自带的 pushedAt 找长期停更），
    // 其余一律标 error 待下轮复查——绝不因为拿不到数据就报"全部健康"
    report = localFallbackReport(market, err as Error);
  } finally {
    if (report) {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
      console.log(`  报告已写入 data/decay-report.json`);
    }
  }

  if (!report) return;
  const el = Math.round((Date.now() - t0) / 1000);
  if (report.aborted) {
    console.warn(`  ⚠️ 部分结果：${report.abortedReason ?? "提前终止"}（已查 ${report.checked}/${market.plugins.length}）`);
  }
  console.log(
    `  检查 ${report.checked} · 健康 ${report.healthy ?? "?"} · 需关注 ${report.findings.length} · 用时 ${el}s`,
  );
  for (const [k, n] of Object.entries(report.byKind)) console.log(`    ${k}: ${n}`);
  for (const f of report.findings.slice(0, 40)) {
    console.log(`    [${f.kind}] ${f.fullName} — ${f.detail}`);
  }
  if (report.findings.length > 40) {
    console.log(`    …共 ${report.findings.length} 条，完整清单见 data/decay-report.json`);
  }
}

/** 探测层整体不可用时的降级报告：本地 pushedAt 判 dormant，其余标 error（只报不删） */
function localFallbackReport(market: MarketData, err: Error): DecayReport {
  const now = Date.now();
  const DORMANT_DAYS = 270;
  const uniq = new Map(market.plugins.map((p) => [p.id, p]));
  const findings = [...uniq.values()].map((p) => {
    const pushed = p.pushedAt ? new Date(p.pushedAt).getTime() : null;
    const days = pushed ? Math.floor((now - pushed) / 86_400_000) : null;
    if (days !== null && days > DORMANT_DAYS) {
      return {
        id: p.id,
        fullName: p.fullName,
        kind: "dormant" as const,
        detail: `长期停更（${days} 天无推送）`,
        stars: p.stars ?? 0,
        pushedAt: p.pushedAt ?? null,
        days,
      };
    }
    return {
      id: p.id,
      fullName: p.fullName,
      kind: "error" as const,
      detail: `探测层不可用，未核实: ${err.message.slice(0, 60)}`,
      stars: p.stars ?? 0,
      pushedAt: p.pushedAt ?? null,
      days: null,
    };
  });
  const byKind: DecayReport["byKind"] = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    checked: findings.length,
    byKind,
    aborted: true,
    abortedReason: `探测层失败降级（${err.message.slice(0, 80)}）`,
    findings: findings.sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

main().catch((err) => {
  console.error("decay scan failed:", err);
  process.exit(1);
});
