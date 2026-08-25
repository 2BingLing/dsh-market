/**
 * 失效条目扫描 CLI（P0-D2）
 * 用法：node --import tsx collector/src/decay-cli.ts
 * 读取 data/plugins.json → 并发探测仓库 → 只报不删 → 写 data/decay-report.json
 * 手工通道：每周 workflow 调用，结果汇总到跟踪 issue（scripts/decay-report-issue.mjs）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./env.js"; // 加载仓库根 .env（GITHUB_TOKEN）
import type { MarketData } from "@dsh-market/schema";
import { scanDecay } from "./decay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");

async function main() {
  const raw = readFileSync(join(DATA_DIR, "plugins.json"), "utf8");
  const market = JSON.parse(raw) as MarketData;
  console.log("=== DSH Market · 失效条目扫描（只报不删）===");
  console.log(`  收录 ${market.plugins.length}，开始探测…（每 200 条报一次进度）`);

  const t0 = Date.now();
  const report = await scanDecay(market, {
    // 给 Actions 日志喂进度：避免"几十秒零输出被误判卡死而手动取消"
    onProgress: (done, total, errs) => {
      const el = Math.round((Date.now() - t0) / 1000);
      console.log(`  [进度] ${done}/${total}，发现 ${errs} 个探测错误，已用 ${el}s`);
    },
  });
  const el = Math.round((Date.now() - t0) / 1000);

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "decay-report.json"), JSON.stringify(report, null, 2), "utf8");

  if (report.aborted) {
    console.warn(`  ⚠️ 熔断：错误数超预算，提前终止（已查 ${report.checked}/${market.plugins.length}），下轮复查`);
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

main().catch((err) => {
  console.error("decay scan failed:", err);
  process.exit(1);
});
