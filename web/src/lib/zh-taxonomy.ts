/**
 * 中文标签体系（§5.3 第二层）：把 zh-intent 词典的 98 个意图作为
 * 「中文语境分类」维度——不是把英文 tag 翻译过来，而是用中文语境的
 * 分类词（记事本/待办/翻译/截图…）给全库做一层确定性归属。
 *
 * 与搜索共用同一份词典（schema/zh-intent）与同一套强弱信号定义：
 *   strong = 标签精确命中 / 名称·仓库名含召回词（高精度，分类/browse 用）
 *   weak   = 简介等 hay 子串命中（高召回，仅搜索扩展补位用）
 *
 * 纯展示层推导：零 schema 改动、不等 06:00 采集、随词典更新即时生效。
 */
import type { DshPlugin } from "@dsh-market/schema";
import { ZH_INTENTS } from "@dsh-market/schema/zh-intent";

export type MatchTier = "strong" | "weak" | null;

/** 对单个插件判断一组召回词的命中层级。hay 传 null 时跳过弱信号判定。 */
export function matchTerms(
  nameLower: string,
  fullNameLower: string,
  tagsLower: string[],
  hay: string | null,
  terms: string[]
): MatchTier {
  let weak = false;
  for (const t of terms) {
    if (tagsLower.includes(t) || nameLower.includes(t) || fullNameLower.includes(t)) {
      return "strong";
    }
    if (hay !== null && !weak && hay.includes(t)) weak = true;
  }
  return weak ? "weak" : null;
}

/** 中文分类 facet：意图 key + 强信号命中的插件（按实用分排序） */
export interface ZhFacet {
  key: string;
  count: number;
  plugins: DshPlugin[];
}

/**
 * 为全库构建中文分类 facets。只统计强信号（browse 场景，精度优先，
 * "宁缺毋滥"与词典设计约定一致）；少于 minCount 个插件的意图不展示。
 * 按覆盖数降序；一次性 O(意图数 × 插件数)，8.4k × 98 在首页加载时约百毫秒级。
 */
export function buildZhFacets(plugins: DshPlugin[], minCount = 3): ZhFacet[] {
  const out: ZhFacet[] = [];
  for (const it of ZH_INTENTS) {
    const strong: DshPlugin[] = [];
    for (const p of plugins) {
      const tier = matchTerms(
        p.name.toLowerCase(),
        p.fullName.toLowerCase(),
        p.tags.map((t) => t.toLowerCase()),
        null,
        it.terms
      );
      if (tier === "strong") strong.push(p);
    }
    if (strong.length >= minCount) {
      strong.sort((a, b) => b.score.total - a.score.total);
      out.push({ key: it.key, count: strong.length, plugins: strong });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}
