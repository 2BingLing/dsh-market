/**
 * 数据源 2：GitHub topic 搜索 + dsh-external 组织仓库
 * topic 搜索结果噪音大，返回后由 detect 层做特征检测过滤
 *
 * 2026-08-14 更新：dsh-plugin topic 已暴涨到 2000+，候选池改为全量收录（不再截断）
 *
 * ⚠️ GitHub Search API 硬限制：单次搜索最多返回前 1000 条（实测 page 11 报
 * "Only the first 1000 search results are available"）。因此用多路排序并集
 * （stars/updated/created 各取前 1000）覆盖长尾仓库——实测 dsh-plugin 2091 个
 * 中三路并集覆盖 1506（72%），耗时 ~90s。未覆盖的为低活跃长尾（stars 低且久
 * 未更新，其中真 DSH 插件比例极低）。
 *
 * 限流：Search API 认证后 30 req/min。每页间隔 sleep 2.3s 防 403（3 路 × 10 页
 * = 30 次请求 ≈ 70s+，安全边界内）。
 */

import {
  githubFetch,
  paginate,
  type GithubRepo,
  type GithubSearchResult,
} from "../github.js";
import { sleep } from "../github.js";

/** topic 数据源配置（max 不再用于截断；每路搜索 API 最多返回 1000 条） */
const TOPIC_SOURCES = [
  { topic: "dsh-plugin" },
  { topic: "dsh" },
  { topic: "deepseek-harness-plugin" },
  { topic: "dsh-bundle" },
  { topic: "dsh-skill" },
];
const ORG = "dsh-external";

/** 多路排序并集：覆盖单路 1000 上限外的长尾仓库 */
const SORT_DIMS = ["stars", "updated", "created"] as const;

/** 搜索 topic 相关仓库（多路并集全量收录） */
export async function scanByTopics(): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (const src of TOPIC_SOURCES) {
    const seen = new Set<string>();
    const items: GithubRepo[] = [];
    for (const sort of SORT_DIMS) {
      const q = encodeURIComponent(`topic:${src.topic}`);
      // 每路最多 10 页（API 上限 1000 条）
      for (let page = 1; page <= 10; page++) {
        const res = await githubFetch<GithubSearchResult>(
          `/search/repositories?q=${q}&sort=${sort}&order=desc&per_page=100&page=${page}`
        );
        for (const r of res.items) {
          if (!seen.has(r.full_name)) {
            seen.add(r.full_name);
            items.push(r);
          }
        }
        if (res.items.length < 100) break; // 该路已到末尾
        await sleep(2300); // Search API 限流 30/min，防 403
      }
      // 路间也等待（同一 topic 多路连续请求）
      await sleep(2300);
    }
    out.push(...items);
    console.log(`  topic:${src.topic} -> ${items.length} repos`);
  }
  return out;
}

/** 扫描 dsh-external 组织全部仓库 */
export async function scanOrg(): Promise<GithubRepo[]> {
  try {
    const repos = await paginate<GithubRepo>(`/orgs/${ORG}/repos?type=public`, 100, 5);
    console.log(`  org:${ORG} -> ${repos.length} repos`);
    return repos;
  } catch (err) {
    console.warn(`  org ${ORG} scan failed: ${(err as Error).message}`);
    return [];
  }
}
