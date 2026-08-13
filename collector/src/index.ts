/**
 * collector 主流程
 * 扫描 → 去重合并 → 特征检测 → 元数据+README → 实用五维评分 → 输出 data/plugins.json
 *
 * 用法：GITHUB_TOKEN=xxx npm run start -w collector
 * 输出：data/plugins.json（市场数据）、data/report.json（统计报告）
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import "./env.js"; // 加载仓库根 .env（GITHUB_TOKEN）
import {
  fetchRepoRoot,
  fetchRawFile,
  fetchFileViaApi,
  githubFetch,
  type GithubRepo,
} from "./github.js";
import { fetchAwesomeEntries, uniqueFullNames } from "./sources/awesome.js";
import { scanByTopics, scanOrg } from "./sources/github-search.js";
import { detectPlugin } from "./detect.js";
import { computePracticalScore, computeP99Stars } from "./scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const EXCLUDED_REPOS = new Set([
  "deepseek-ai/deepseek-harness", // 官方本体，非插件
  "deepseek-ai/awesome-deepseek-harness",
]);

interface Candidate {
  repo: GithubRepo | null;
  fullName: string;
  sources: string[];
  awesomeName?: string;
  awesomeDescription?: string;
  awesomeCategory?: string | null;
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error("缺少 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }

  console.log("=== DSH Market collector ===");
  console.log("[1/5] 扫描数据源...");

  // 1. awesome 列表（人工策展，带分类）
  const awesomeEntries = await fetchAwesomeEntries(async (o, r, p) => {
    const res = await fetch(`https://raw.githubusercontent.com/${o}/${r}/main/${p}`);
    if (!res.ok) {
      const res2 = await fetch(`https://raw.githubusercontent.com/${o}/${r}/master/${p}`);
      return res2.ok ? res2.text() : null;
    }
    return res.text();
  });
  const awesomeNames = uniqueFullNames(awesomeEntries);
  console.log(`  awesome lists -> ${awesomeNames.length} unique repos`);
  const awesomeByFullName = new Map(
    awesomeEntries.map((e) => [e.fullName, e])
  );

  // 2. topic 搜索 + 组织
  const topicRepos = await scanByTopics();
  const orgRepos = await scanOrg();
  const seen = new Set<string>();
  const candidates = new Map<string, Candidate>();

  function addCandidate(
    fullName: string,
    repo: GithubRepo | null,
    source: string,
    meta?: { name?: string; description?: string; category?: string | null }
  ) {
    const key = fullName.toLowerCase();
    if (EXCLUDED_REPOS.has(key)) return;
    const existing = candidates.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (!existing.repo && repo) existing.repo = repo;
      return;
    }
    candidates.set(key, {
      repo,
      fullName,
      sources: [source],
      awesomeName: meta?.name,
      awesomeDescription: meta?.description,
      awesomeCategory: meta?.category,
    });
  }

  for (const fn of awesomeNames) {
    const entry = awesomeByFullName.get(fn);
    addCandidate(fn, null, entry?.source ?? "awesome", {
      name: entry?.name,
      description: entry?.description,
      category: entry?.category,
    });
  }
  for (const r of topicRepos) addCandidate(r.full_name, r, "topic");
  for (const r of orgRepos) addCandidate(r.full_name, r, "org");

  // 过滤 fork / archived
  const activeCandidates = [...candidates.values()].filter((c) => {
    if (c.repo && (c.repo.fork || c.repo.archived)) return false;
    return true;
  });
  console.log(`  total candidates: ${candidates.size} (active: ${activeCandidates.length})`);

  console.log("[2/5] 特征检测 + 元数据抓取...");
  const detected: Array<{ candidate: Candidate; plugin: DshPlugin; repo: GithubRepo; detection: Awaited<ReturnType<typeof detectPlugin>>; readmeContent: string | null }> = [];
  const rejected: string[] = [];
  let apiCalls = 0;

  for (const candidate of activeCandidates) {
    try {
      let repo = candidate.repo;
      if (!repo) {
        repo = await githubFetch<GithubRepo>(`/repos/${candidate.fullName}`);
        apiCalls++;
        // 过滤 fork/archived（awesome 里混入的）
        if (repo.fork || repo.archived) {
          rejected.push(`${candidate.fullName} (fork/archived)`);
          continue;
        }
      }

      // 根目录文件列表（特征检测用）
      const rootItems = await fetchRepoRoot(repo.full_name, repo.default_branch);
      apiCalls++;

      // README（raw 不占 API 配额）
      const readmeContent = await fetchRawFile(
        repo.full_name,
        "README.md",
        repo.default_branch
      );

      const detection = await detectPlugin(repo.full_name, rootItems, readmeContent);
      if (!detection.isPlugin) {
        rejected.push(`${repo.full_name} (no plugin markers)`);
        continue;
      }

      // skill 型：抓取 SKILL.md 内容做摘要（评分以 README 为主）
      let skillMd: string | null = null;
      if (detection.skillFiles.length > 0) {
        const sk = detection.skillFiles[0];
        skillMd = await fetchRawFile(repo.full_name, sk, repo.default_branch);
      }

      // README 摘要（截断供详情页）
      const readmeSummary = readmeContent
        ? readmeContent.replace(/\s+/g, " ").slice(0, 500)
        : skillMd
          ? skillMd.replace(/\s+/g, " ").slice(0, 500)
          : null;

      const plugin: DshPlugin = {
        id: repo.full_name,
        type: detection.type!,
        name: candidate.awesomeName ?? repo.name,
        owner: repo.owner.login,
        repo: repo.name,
        fullName: repo.full_name,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        openIssues: repo.open_issues_count,
        language: repo.language,
        description: candidate.awesomeDescription ?? repo.description ?? "",
        descriptionZh: null, // M3: DeepSeek 生成
        tags: [...repo.topics],
        curated: false,
        homepage: repo.homepage,
        license: repo.license?.spdx_id ?? null,
        topics: repo.topics,
        pushedAt: repo.pushed_at,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        readmeSummary,
        install: {
          method: detection.installMethod!,
          target:
            detection.type === "skill"
              ? "~/.agents/skills"
              : undefined,
          needsConfig: detection.needsConfig,
        },
        score: undefined as unknown as DshPlugin["score"], // 下一阶段统一计算（需 p99）
        sources: candidate.sources,
        lastCheckedAt: new Date().toISOString(),
      };
      detected.push({ candidate, plugin, repo, detection, readmeContent });
    } catch (err) {
      console.warn(`  skip ${candidate.fullName}: ${(err as Error).message}`);
      rejected.push(`${candidate.fullName} (error: ${(err as Error).message.slice(0, 60)})`);
    }
  }
  console.log(`  detected plugins: ${detected.length}, rejected: ${rejected.length}, apiCalls: ${apiCalls}`);

  console.log("[3/5] 实用五维评分...");
  const p99 = computeP99Stars(detected.map((d) => d.repo.stargazers_count));
  for (const d of detected) {
    const input = {
      stars: d.repo.stargazers_count,
      forks: d.repo.forks_count,
      openIssues: d.repo.open_issues_count,
      pushedAt: d.repo.pushed_at,
      hasDescription: Boolean(d.repo.description),
      hasLicense: Boolean(d.repo.license),
      hasHomepage: Boolean(d.repo.homepage),
      topics: d.repo.topics,
      readmeContent: d.readmeContent,
      hasSkillMd: d.detection.skillFiles.length > 0,
      needsConfig: d.detection.needsConfig,
    };
    d.plugin.score = computePracticalScore(input, p99);
  }
  console.log(`  p99 stars = ${p99}`);

  console.log("[4/5] 生成数据文件...");
  const market: MarketData = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugins: detected.map((d) => d.plugin),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    join(DATA_DIR, "plugins.json"),
    JSON.stringify(market, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(DATA_DIR, "report.json"),
    JSON.stringify(
      {
        generatedAt: market.generatedAt,
        total: market.plugins.length,
        byType: market.plugins.reduce<Record<string, number>>((acc, p) => {
          acc[p.type] = (acc[p.type] ?? 0) + 1;
          return acc;
        }, {}),
        bySource: Object.entries(
          market.plugins.reduce<Record<string, number>>((acc, p) => {
            for (const s of p.sources) acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          }, {})
        ),
        p99Stars: p99,
        top10: market.plugins
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
          .map((p) => ({
            id: p.id,
            score: p.score.total,
            stars: p.stars,
            explanation: p.score.explanation,
          })),
        rejected: rejected.slice(0, 50),
        rejectedCount: rejected.length,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log("[5/5] 完成");
  console.log(`  plugins.json: ${market.plugins.length} plugins`);
  console.log(`  top5: ${market.plugins.sort((a, b) => b.score.total - a.score.total).slice(0, 5).map((p) => `${p.id}(${p.score.total})`).join(", ")}`);
}

main().catch((err) => {
  console.error("collector failed:", err);
  process.exit(1);
});
