/**
 * 数据源 2：GitHub topic 搜索 + dsh-external 组织仓库
 * topic 搜索结果噪音大，返回后由 detect 层做特征检测过滤
 */

import {
  githubFetch,
  paginate,
  type GithubRepo,
  type GithubSearchResult,
} from "../github.js";

const TOPICS = ["dsh-plugin", "deepseek-harness-plugin", "dsh"];
const ORG = "dsh-external";

/** 搜索 topic 相关仓库（按 stars 排序，取前 N 页） */
export async function scanByTopics(maxPerTopic = 200): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (const topic of TOPICS) {
    const q = encodeURIComponent(`topic:${topic}`);
    const first = await githubFetch<GithubSearchResult>(
      `/search/repositories?q=${q}&sort=stars&order=desc&per_page=100`
    );
    out.push(...first.items);
    // 搜索 API 每请求最多 1000 条，这里保守取 200
    if (first.items.length === 100) {
      const second = await githubFetch<GithubSearchResult>(
        `/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=2`
      );
      out.push(...second.items);
    }
    console.log(`  topic:${topic} -> ${first.total_count} total, took ${first.items.length + (first.items.length === 100 ? 100 : 0)}`);
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
