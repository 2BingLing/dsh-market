/**
 * 维护者定向收录整合包（人工审核通道，不依赖全量扫描）
 *
 * 用法：node --import tsx scripts/pack-add.ts owner/repo [owner/repo2 ...]
 * 行为：对每个仓库做整合包检测（dsh.pack.json / pack.json / *.pack.json 清单，
 *       无清单则 README 宽松信号）→ 条目解析（GitHub/npm 存在性 + 市场收录匹配）
 *       → 评分 → 追加/更新 data/packs.json（按 id 去重）
 *
 * 流程：收到 [提交整合包] issue → 审核仓库 → 跑本脚本 → 提交 data/packs.json
 *       → 每日 workflow 自动同步 web/public/packs.json 并部署。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshPack } from "@dsh-market/schema";
import { detectPack, resolvePackEntries, buildPack } from "../collector/src/packs.js";
import { cached } from "../collector/src/cache.js";
import { githubFetch, fetchFileViaApi, type GithubRepo } from "../collector/src/github.js";
import { computeP99Stars } from "../collector/src/scoring.js";

const here = dirname(fileURLToPath(import.meta.url));
const PACKS_FILE = join(here, "../data/packs.json");
const PLUGINS_FILE = join(here, "../data/plugins.json");

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);

async function main() {
  const repos = process.argv.slice(2);
  if (repos.length === 0) {
    console.error("用法: node --import tsx scripts/pack-add.ts owner/repo [owner/repo2 ...]");
    process.exit(1);
  }

  // 市场插件（inMarket 匹配 + p99）
  let marketIds = new Set<string>();
  let p99 = 500;
  try {
    const market = JSON.parse(readFileSync(PLUGINS_FILE, "utf8"));
    for (const p of market.plugins) {
      marketIds.add(p.id.toLowerCase());
      if (p.fullName) marketIds.add(p.fullName.toLowerCase());
    }
    const stars = market.plugins.map((p: any) => p.stars).sort((a: number, b: number) => b - a);
    p99 = stars[Math.floor(stars.length * 0.01)] ?? 500;
  } catch {
    console.warn("未找到 data/plugins.json，inMarket 匹配将全部为 false");
  }

  // 已有 packs（按 id 索引，用于追加/更新）
  let packs: DshPack[] = [];
  try {
    packs = JSON.parse(readFileSync(PACKS_FILE, "utf8")).packs ?? [];
  } catch {
    packs = [];
  }
  const byId = new Map(packs.map((p) => [p.id.toLowerCase(), p]));

  for (const fullName of repos) {
    const t0 = Date.now();
    try {
      const repo = await withTimeout(
        cached<GithubRepo>("repos", fullName, () => githubFetch<GithubRepo>(`/repos/${fullName}`)),
        15000,
        "repo"
      );
      if (repo.fork || repo.archived) {
        console.error(`✗ ${fullName}：fork/archived，不收`);
        continue;
      }

      const rootList = await withTimeout(
        cached<{ name: string }[] | null>("roots", fullName, async () =>
          githubFetch<{ name: string }[]>(`/repos/${fullName}/contents`).catch(() => null)
        ),
        15000,
        "roots"
      );
      const names = (rootList ?? []).map((i) => i.name);

      const readme = await withTimeout(
        cached<string | null>("readmes", fullName, async () => {
          const res = await fetch(
            `https://raw.githubusercontent.com/${fullName}/HEAD/README.md`,
            { headers: { "User-Agent": "dsh-market-collector" }, signal: AbortSignal.timeout(15000) }
          );
          return res.ok ? await res.text() : null;
        }),
        30000,
        "readme"
      );

      const detected = await withTimeout(
        detectPack(fullName, names, (path) =>
          withTimeout(fetchFileViaApi(fullName, path), 15000, `fetch ${path}`)
        , readme),
        60000,
        "detect"
      );
      if (!detected) {
        console.error(`✗ ${fullName}：无清单文件且无整合包信号（README 需描述"整合包/一键装多插件"）`);
        continue;
      }

      const entries = await withTimeout(
        resolvePackEntries(detected.manifest.entries, marketIds),
        120000,
        "resolve"
      );
      const pack = buildPack(repo, detected.manifest, entries, readme, ["manual"], p99);
      byId.set(pack.id.toLowerCase(), pack);
      console.log(
        `✓ ${fullName}（${detected.manifest.manifestFile}）条目 ${pack.entryStats.total} / 可解析 ${pack.entryStats.ok} / 在市场 ${pack.entryStats.inMarket} / 评分 ${pack.score.total}`
      );
    } catch (err) {
      console.error(`✗ ${fullName}：${(err as Error).message.slice(0, 80)}`);
    }
    console.log(`  （耗时 ${Date.now() - t0}ms）`);
  }

  const next = [...byId.values()].sort((a, b) => b.score.total - a.score.total);
  writeFileSync(
    PACKS_FILE,
    JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), packs: next }, null, 2),
    "utf8"
  );
  console.log(`\ndata/packs.json 已更新：${next.length} 个整合包`);
  console.log("提交后每日 workflow 会同步到 web/public/packs.json 并部署。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
