/**
 * collector 主流程（v2：并发 + 缓存）
 * 扫描 → 去重合并 → 特征检测 → 元数据+README → 实用五维评分 → 输出 data/plugins.json
 *
 * 用法：npm run collect（根目录，自动加载 .env 的 GITHUB_TOKEN）
 * 输出：data/plugins.json（市场数据）、data/report.json（统计报告）
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import "./env.js"; // 加载仓库根 .env（GITHUB_TOKEN）
import {
  githubFetch,
  fetchRepoRoot,
  fetchRawFile,
  fetchFileViaApi,
  type GithubRepo,
} from "./github.js";
import { fetchAwesomeEntries } from "./sources/awesome.js";
import { scanByTopics, scanOrg } from "./sources/github-search.js";
import { detectPlugin, isCordisPackageJson, detectNeedsConfig } from "./detect.js";
import { computePracticalScore, computeP99Stars } from "./scoring.js";
import { cached } from "./cache.js";
import { runPool } from "./pool.js";
import { translateWithDeepSeek } from "./llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const CONCURRENCY = 10;
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
}

interface Detected {
  candidate: Candidate;
  plugin: DshPlugin;
  repo: GithubRepo;
  readmeContent: string | null;
  hasSkillMd: boolean;
}

/** 读取上次生成的中文数据（增量：只翻译缺失的插件） */
function loadPreviousZh(): Map<string, { descriptionZh: string | null; tagsZh: string[] }> {
  try {
    const raw = readFileSync(join(DATA_DIR, "plugins.json"), "utf-8");
    const prev = JSON.parse(raw) as MarketData;
    return new Map(
      prev.plugins.map((p) => [
        p.id,
        { descriptionZh: p.descriptionZh ?? null, tagsZh: (p.tags ?? []).filter((t) => /[\u4e00-\u9fff]/.test(t)) },
      ])
    );
  } catch {
    return new Map();
  }
}

/** 智能摘要：在句子边界截断，不切断句子，截断处加省略号 */
export function summarizeReadme(text: string, maxLen = 420): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const boundary = Math.max(
    cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"),
    cut.lastIndexOf("；"), cut.lastIndexOf(". "), cut.lastIndexOf("! "),
    cut.lastIndexOf("? "), cut.lastIndexOf("; "), cut.lastIndexOf("："),
    cut.lastIndexOf(": ")
  );
  const end = boundary > maxLen * 0.45 ? boundary + 1 : maxLen;
  return clean.slice(0, end) + "…";
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error("缺少 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }

  console.log("=== DSH Market collector v2 ===");
  console.log("[1/5] 扫描数据源...");

  // 1. awesome 列表（人工策展）
  const awesomeEntries = await fetchAwesomeEntries(async (o, r, p) => {
    for (const branch of ["main", "master"]) {
      const res = await fetch(
        `https://raw.githubusercontent.com/${o}/${r}/${branch}/${p}`,
        { headers: { "User-Agent": "dsh-market-collector" } }
      );
      if (res.ok) return res.text();
    }
    return null;
  });
  const awesomeByFullName = new Map(
    awesomeEntries.map((e) => [e.fullName, e])
  );
  console.log(`  awesome lists -> ${awesomeByFullName.size} entries`);

  // 2. topic 搜索 + 组织
  const topicRepos = await scanByTopics();
  const orgRepos = await scanOrg();

  // 3. 合并去重
  const candidates = new Map<string, Candidate>();
  const addCandidate = (
    fullName: string,
    repo: GithubRepo | null,
    source: string,
    meta?: { name?: string; description?: string }
  ) => {
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
    });
  };
  for (const fn of awesomeByFullName.keys()) {
    const e = awesomeByFullName.get(fn)!;
    addCandidate(fn, null, e.source, { name: e.name, description: e.description });
  }
  for (const r of topicRepos) addCandidate(r.full_name, r, "topic");
  for (const r of orgRepos) addCandidate(r.full_name, r, "org");

  const all = [...candidates.values()];
  console.log(`  candidates: ${all.length}`);

  console.log("[2/5] 特征检测 + 元数据抓取（并发 10，带缓存）...");
  const detected: Detected[] = [];
  const rejected: { fullName: string; reason: string }[] = [];

  await runPool(all, async (candidate) => {
    try {
      // repo 元数据（缓存 24h）
      let repo = candidate.repo;
      if (!repo) {
        repo = await cached<GithubRepo>("repos", candidate.fullName, () =>
          githubFetch<GithubRepo>(`/repos/${candidate.fullName}`)
        );
        if (repo.fork || repo.archived) {
          rejected.push({ fullName: candidate.fullName, reason: "fork/archived" });
          return;
        }
      }

      // 根目录文件列表（缓存 24h）
      const rootItems = await cached(
        "roots",
        candidate.fullName,
        () => fetchRepoRoot(repo!.full_name, repo!.default_branch)
      );

      // 特征检测（只基于文件列表）
      const detection = await detectPlugin(candidate.fullName, rootItems);
      if (!detection.isPlugin) {
        rejected.push({ fullName: candidate.fullName, reason: "no plugin markers" });
        return;
      }

      // package.json 二次确认（仅当是 cordis 候选且根目录有 package.json）
      let packageJsonContent: string | null = null;
      const hasPkgJson = rootItems.some(
        (i) => i.name.toLowerCase() === "package.json"
      );
      if (hasPkgJson) {
        packageJsonContent = await cached<string | null>(
          "pkgjson",
          candidate.fullName,
          async () => {
            const f = await fetchFileViaApi(candidate.fullName, "package.json");
            return f?.content ?? null;
          }
        );
      }
      const isCordis = isCordisPackageJson(packageJsonContent);
      if (detection.type === "cordis-plugin" && !isCordis) {
        rejected.push({ fullName: candidate.fullName, reason: "package.json not cordis" });
        return;
      }

      // README（缓存 24h）
      const readmeContent = await cached<string | null>(
        "readmes",
        candidate.fullName,
        () => fetchRawFile(candidate.fullName, "README.md", repo!.default_branch)
      );

      // skill 型：抓 SKILL.md 做摘要
      let skillMd: string | null = null;
      if (detection.skillFiles.length > 0) {
        skillMd = await cached<string | null>(
          "skills",
          `${candidate.fullName}:${detection.skillFiles[0]}`,
          () =>
            fetchRawFile(
              candidate.fullName,
              detection.skillFiles[0],
              repo!.default_branch
            )
        );
      }

      const needsConfig = detectNeedsConfig(readmeContent);
      const readmeSummary = readmeContent
        ? summarizeReadme(readmeContent)
        : skillMd
          ? summarizeReadme(skillMd)
          : null;

      const plugin: DshPlugin = {
        id: repo!.full_name,
        type: detection.type!,
        name: candidate.awesomeName ?? repo!.name,
        owner: repo!.owner.login,
        repo: repo!.name,
        fullName: repo!.full_name,
        stars: repo!.stargazers_count,
        forks: repo!.forks_count,
        openIssues: repo!.open_issues_count,
        language: repo!.language,
        description: candidate.awesomeDescription ?? repo!.description ?? "",
        descriptionZh: null, // M3: DeepSeek 生成
        tags: [...repo!.topics],
        curated: false,
        homepage: repo!.homepage,
        license: repo!.license?.spdx_id ?? null,
        topics: repo!.topics,
        pushedAt: repo!.pushed_at,
        createdAt: repo!.created_at,
        updatedAt: repo!.updated_at,
        readmeSummary,
        install: {
          method: detection.installMethod!,
          target: detection.type === "skill" ? "~/.agents/skills" : undefined,
          needsConfig,
        },
        score: undefined as unknown as DshPlugin["score"],
        sources: candidate.sources,
        lastCheckedAt: new Date().toISOString(),
      };
      detected.push({
        candidate,
        plugin,
        repo: repo!,
        readmeContent,
        hasSkillMd: detection.skillFiles.length > 0,
      });
    } catch (err) {
      rejected.push({
        fullName: candidate.fullName,
        reason: `error: ${(err as Error).message.slice(0, 80)}`,
      });
    }
  });

  console.log(`  detected: ${detected.length}, rejected: ${rejected.length}`);

  // 去重：GitHub 仓库转移会让同一仓库从多个旧路径进入，full_name 归一化后 id 相同
  {
    const byId = new Map<string, Detected>();
    for (const d of detected) {
      const existing = byId.get(d.plugin.id);
      if (existing) {
        for (const s of d.plugin.sources) {
          if (!existing.plugin.sources.includes(s)) existing.plugin.sources.push(s);
        }
        continue;
      }
      byId.set(d.plugin.id, d);
    }
    const deduped = [...byId.values()];
    if (deduped.length !== detected.length) {
      console.log(`  dedup: ${detected.length} -> ${deduped.length} (repo transfers)`);
    }
    detected.length = 0;
    detected.push(...deduped);
  }

  console.log("[3/5] 实用五维评分...");
  const p99 = computeP99Stars(detected.map((d) => d.repo.stargazers_count));
  for (const d of detected) {
    d.plugin.score = computePracticalScore(
      {
        stars: d.repo.stargazers_count,
        forks: d.repo.forks_count,
        openIssues: d.repo.open_issues_count,
        pushedAt: d.repo.pushed_at,
        hasDescription: Boolean(d.repo.description),
        hasLicense: Boolean(d.repo.license),
        hasHomepage: Boolean(d.repo.homepage),
        topics: d.repo.topics,
        readmeContent: d.readmeContent,
        hasSkillMd: d.hasSkillMd,
        needsConfig: d.plugin.install.needsConfig,
      },
      p99
    );
  }
  console.log(`  p99 stars = ${p99}`);

  console.log("[3.5/5] 中文化（DeepSeek 增量翻译）...");
  const prevZh = loadPreviousZh();
  let translated = 0;
  let skipped = 0;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  if (apiKey) {
    const pending = detected.filter((d) => {
      const prev = prevZh.get(d.plugin.id);
      if (d.plugin.descriptionZh) return false; // 本次已有
      if (prev?.descriptionZh) {
        // 复用上次结果
        d.plugin.descriptionZh = prev.descriptionZh;
        for (const t of prev.tagsZh) {
          if (!d.plugin.tags.includes(t)) d.plugin.tags.push(t);
        }
        skipped++;
        return false;
      }
      return true;
    });
    console.log(`  pending translate: ${pending.length}, reused: ${skipped}`);

    await runPool(
      pending,
      async (d) => {
        const result = await translateWithDeepSeek(
          {
            name: d.plugin.name,
            description: d.plugin.description,
            readmeSummary: d.plugin.readmeSummary,
            topics: d.plugin.topics,
          },
          { apiKey, baseURL, model }
        );
        if (result) {
          d.plugin.descriptionZh = result.descriptionZh;
          for (const t of result.tagsZh) {
            if (!d.plugin.tags.includes(t)) d.plugin.tags.push(t);
          }
          translated++;
          console.log(`    ✓ ${d.plugin.id} -> ${result.descriptionZh.slice(0, 40)}`);
        }
      },
      5 // LLM 并发保守
    );
    console.log(`  translated: ${translated}, failed: ${pending.length - translated}`);
  } else {
    console.log("  未配置 DEEPSEEK_API_KEY，跳过中文化（仅保留英文）");
  }

  console.log("[4/5] 生成数据文件...");
  const market: MarketData = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugins: detected.map((d) => d.plugin),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "plugins.json"), JSON.stringify(market, null, 2), "utf-8");
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
        top10: [...market.plugins]
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
          .map((p) => ({
            id: p.id,
            score: p.score.total,
            stars: p.stars,
            explanation: p.score.explanation,
          })),
        rejectedCount: rejected.length,
        rejected: rejected.slice(0, 30),
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log("[5/5] 完成");
  const top5 = [...market.plugins]
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 5)
    .map((p) => `${p.id}(${p.score.total})`)
    .join(", ");
  console.log(`  plugins.json: ${market.plugins.length} plugins`);
  console.log(`  top5: ${top5}`);
}

main().catch((err) => {
  console.error("collector failed:", err);
  process.exit(1);
});
