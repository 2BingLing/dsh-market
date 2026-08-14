/**
 * 搜索：Fuse.js 关键词召回 + 标签 AND 过滤 + 排序
 * 支持语义翻译注入（UI 层可把自然语言经 LLM 翻译成标签后传入 semanticTags）。
 */
import Fuse from "fuse.js";
import type { DshPlugin } from "@dsh-market/schema";
import { matchesTags, usableTags } from "./tags.js";

export interface SearchOptions {
  /** 语义翻译出的标签（LLM 增强：自然语言 → 标签），与关键词共同参与召回 */
  semanticTags?: string[];
  /** 标签 AND 过滤 */
  tags?: string[];
  /** 插件类型过滤 */
  type?: "skill" | "cordis-plugin" | null;
  /** 需要配置（needsConfig）过滤：false 时只返回 needsConfig=false 的 */
  noConfigOnly?: boolean;
  /** 排序：relevance（默认）/ score / newest */
  sortBy?: "relevance" | "score" | "newest";
  /** 返回条数 */
  limit?: number;
  /** 排除的插件 id（已装） */
  excludeIds?: string[];
}

export interface SearchResult {
  plugin: DshPlugin;
  /** 0-100 相关度（Fuse 分数换算） */
  relevance: number;
  /** 标签命中数（语义/过滤标签） */
  tagHits: number;
}

/** 构建 Fuse 索引 */
export function createSearchIndex(plugins: DshPlugin[]): Fuse<DshPlugin> {
  return new Fuse(plugins, {
    keys: [
      { name: "name", weight: 0.4 },
      { name: "fullName", weight: 0.2 },
      { name: "descriptionZh", weight: 0.25 },
      { name: "description", weight: 0.1 },
      { name: "tags", weight: 0.05 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
  });
}

/** 关键词搜索（空查询返回全部，按 score 排序） */
export function search(
  plugins: DshPlugin[],
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const fuse = createSearchIndex(plugins);
  const q = query.trim();

  // 关键词召回：Fuse 结果 + 子串兜底（Fuse 对中文/短查询可能漏）
  let hits: Array<{ item: DshPlugin; score: number }> = [];
  if (q) {
    hits = fuse.search(q).map((r) => ({
      item: r.item,
      score: r.score ?? 1,
    }));
    // 子串兜底：把 fuse 漏掉的直接子串匹配加进来（score 给 0.6 附近）
    const seen = new Set(hits.map((h) => h.item.id));
    const lower = q.toLowerCase();
    for (const p of plugins) {
      if (seen.has(p.id)) continue;
      const haystack = [
        p.name,
        p.fullName,
        p.descriptionZh ?? "",
        p.description,
        p.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(lower)) {
        hits.push({ item: p, score: 0.55 });
      }
    }
  } else {
    hits = plugins.map((p) => ({ item: p, score: 1 }));
  }

  const semantic = new Set(options.semanticTags ?? []);
  const tagFilter = options.tags ?? [];

  const results: SearchResult[] = hits
    .map((h) => {
      const p = h.item;
      // 标签命中数 = 语义标签 + 过滤标签 的总命中
      const tagHits = [...semantic, ...tagFilter].filter((t) =>
        p.tags.includes(t),
      ).length;
      return {
        plugin: p,
        relevance: Math.round((1 - h.score) * 100),
        tagHits,
      };
    })
    .filter((r) => {
      const p = r.plugin;
      if (options.type && p.type !== options.type) return false;
      if (options.noConfigOnly && p.install.needsConfig) return false;
      if (!matchesTags(p, tagFilter)) return false;
      if (options.excludeIds?.includes(p.id)) return false;
      return true;
    });

  // 排序
  const sortBy = options.sortBy ?? "relevance";
  results.sort((a, b) => {
    if (sortBy === "score") return b.plugin.score.total - a.plugin.score.total;
    if (sortBy === "newest") {
      return (
        new Date(b.plugin.pushedAt).getTime() -
        new Date(a.plugin.pushedAt).getTime()
      );
    }
    // relevance：先比标签命中（语义翻译的强信号），再比相关度，再比实用分
    return (
      b.tagHits - a.tagHits ||
      b.relevance - a.relevance ||
      b.plugin.score.total - a.plugin.score.total
    );
  });

  return (options.limit ? results.slice(0, options.limit) : results).map(
    ({ plugin, relevance, tagHits }) => ({
      plugin,
      relevance,
      tagHits:
        tagHits +
        usableTags(plugin).filter((t) => semantic.has(t)).length,
    }),
  );
}
