/**
 * 数据源 2：GitHub topic 搜索 + dsh-external 组织仓库
 * topic 搜索结果噪音大，返回后由 detect 层做特征检测过滤
 *
 * 2026-08-14 更新：dsh-plugin topic 已暴涨到 800+，候选池改为全量收录（不再截断到 100）
 */

import {
  githubFetch,
  paginate,
  type GithubRepo,
  type GithubSearchResult,
} from "../github.js";
import { sleep } from "../github.js";

/** topic 数据源配置：{topic, max}，max 覆盖该 topic 的当前规模 */
const TOPIC_SOURCES = [
  { topic: "dsh-plugin", max: 900 },
  { topic: "dsh", max: 400 },
  { topic: "deepseek-harness-plugin", max: 100 },
  { topic: "dsh-bundle", max: 100 },
  { topic: "dsh-skill", max: 50 },
];
const ORG = "dsh-external";

/** 搜索 topic 相关仓库（全量收录，搜索 API 限速 30/min → 每页间隔 2s） */
export async function scanByTopics(): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (const src of TOPIC_SOURCES) {
    const q = encodeURIComponent(`topic:${src.topic}`);
    const items: GithubRepo[] = [];
    const pages = Math.ceil(src.max / 100);
    for (let page = 1; page <= pages; page++) {
      const res = await githubFetch<GithubSearchResult>(
        `/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`
      );
      items.push(...res.items);
      if (res.items.length < 100) break;
      if (page < pages) await sleep(2000); // 搜索 API 独立限流，防 403
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
