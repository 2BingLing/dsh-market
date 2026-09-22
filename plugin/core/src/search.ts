/**
 * 搜索：Fuse.js 关键词召回 + 中文意图词典扩展 + 标签 AND 过滤 + 排序
 * 支持语义翻译注入（UI 层可把自然语言经 LLM 翻译成标签后传入 semanticTags）。
 */
import Fuse from "fuse.js";
import type { DshPlugin } from "@dsh-market/schema";
import { matchesTags, usableTags } from "./tags.js";
import { expandZhQuery } from "./zh-intent.js";

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
  /** 中文意图词典命中的意图名（如「记事本」），用于结果页提示"为什么搜到了它" */
  via?: string[];
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

  // 关键词召回：子串命中优先（Fuse 按匹配长度占比归一化，长名仓库吃亏；
  // 直接子串命中不依赖长度，且高质量（高分）仓库应排前），Fuse 模糊补漏；
  // 中文意图词典：查询命中触发词 → 扩展召回词参与扫描（"记事本"→ notes/memo/笔记…），
  // 解决"字面不相交但语义相同"的召回空洞（这一层是确定性的，零 token）
  let hits: Array<{ item: DshPlugin; score: number }> = [];
  const viaOf = new Map<string, string[]>();
  if (q) {
    const lower = q.toLowerCase();
    const zh = expandZhQuery(q);
    // 扩展词 → 意图 反查表（命中插件时标记 via）
    const termIntent = new Map<string, string>();
    for (const e of zh.expansions) for (const t of e.terms) termIntent.set(t, e.intent);
    const seen = new Set<string>();
    // 1) 直接子串 + 中文意图扩展词（共享一次 haystack 构建）
    for (const p of plugins) {
      const hayTags = p.tags.join(" ");
      const haystack = `${p.name} ${p.fullName} ${p.descriptionZh ?? ""} ${p.description} ${hayTags}`.toLowerCase();
      if (haystack.includes(lower)) {
        hits.push({ item: p, score: 0.05 });
        seen.add(p.id);
        if (zh.intents.length > 0) continue; // 主命中优先；扩展命中不再重复计
      }
      // 意图扩展词扫描：标签精确命中 > 字段子串命中
      let best: number | null = null;
      const hitIntents = new Set<string>();
      for (const t of zh.terms) {
        if (p.tags.includes(t)) {
          best = best === null ? 0.15 : Math.min(best, 0.15);
          hitIntents.add(termIntent.get(t) ?? "");
        } else if (haystack.includes(t)) {
          best = best === null ? 0.3 : Math.min(best, 0.3);
          hitIntents.add(termIntent.get(t) ?? "");
        }
      }
      if (best !== null) {
        hits.push({ item: p, score: best });
        seen.add(p.id);
        const via = [...hitIntents].filter(Boolean);
        if (via.length > 0) viaOf.set(p.id, via);
      }
    }
    // 2) Fuse 模糊补漏（跳过已子串命中的）
    for (const r of fuse.search(q)) {
      if (seen.has(r.item.id)) continue;
      hits.push({ item: r.item, score: r.score ?? 1 });
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
      const via = viaOf.get(p.id);
      return {
        plugin: p,
        relevance: Math.round((1 - h.score) * 100),
        tagHits,
        ...(via ? { via } : {}),
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
    ({ plugin, relevance, tagHits, via }) => ({
      plugin,
      relevance,
      tagHits:
        tagHits +
        usableTags(plugin).filter((t) => semantic.has(t)).length,
      ...(via ? { via } : {}),
    }),
  );
}
