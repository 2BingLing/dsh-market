/**
 * 中文标签体系（§5.3 第二层）：把 zh-intent 词典的意图作为
 * 「中文语境分类」维度——不是把英文 tag 翻译过来，而是用中文语境的
 * 分类词（记事本/待办/翻译/截图…）给全库做一层确定性归属。
 *
 * 与搜索共用同一份词典（zh-intent）与同一套强弱信号定义：
 *   strong = 标签精确命中 / 名称·仓库名含召回词（词边界召回词按 token 判定）
 *   weak   = 简介等 hay 子串命中（高召回，仅搜索扩展补位用）
 *
 * 纯展示层推导：零 schema 数据改动、不等 06:00 采集、随词典更新即时生效。
 * 泛型适配两端数据形状：web 全量（score.total）与插件端 lite（scoreTotal）都能喂。
 */
import type { DshPlugin } from "./types.js";
import { ZH_INTENTS, isTokenTerm, rawTerm, tokenInText } from "./zh-intent.js";

export type MatchTier = "strong" | "weak" | null;

/**
 * 参与分类匹配的最小字段面。DshPlugin（web）与插件端 LitePlugin
 * （score 是 scoreTotal）都结构性满足，facets 因此可在三端复用。
 */
export interface FacetablePlugin {
  name: string;
  fullName: string;
  tags: string[];
  /** 实用分（全量数据是 score.total；lite 数据直接给 scoreTotal） */
  score?: { total: number } | null;
  scoreTotal?: number;
}

/** facet 条目：意图 key + 强信号命中的插件（按实用分排序） */
export interface ZhFacet<T = DshPlugin> {
  key: string;
  count: number;
  plugins: T[];
}

/** 实用分归一读取（全量 score.total / lite scoreTotal 双形态） */
export function facetScoreOf(p: FacetablePlugin): number {
  return p.score?.total ?? p.scoreTotal ?? 0;
}

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
    const raw = rawTerm(t);
    if (tagsLower.includes(raw)) return "strong";
    if (isTokenTerm(t)) {
      // 词边界召回词：名称/简介里作为独立词出现才算（防 email/main 吃掉 "ai"）
      if (tokenInText(raw, nameLower) || tokenInText(raw, fullNameLower)) return "strong";
      if (hay !== null && !weak && tokenInText(raw, hay)) weak = true;
    } else {
      if (nameLower.includes(raw) || fullNameLower.includes(raw)) return "strong";
      if (hay !== null && !weak && hay.includes(raw)) weak = true;
    }
  }
  return weak ? "weak" : null;
}

/** 意图 key → 召回词（查不到返回 null；分类过滤 UI 用） */
export function intentTerms(key: string): string[] | null {
  return ZH_INTENTS.find((it) => it.key === key)?.terms ?? null;
}

/**
 * 为全库构建中文分类 facets。只统计强信号（browse 场景，精度优先，
 * "宁缺毋滥"与词典设计约定一致）；少于 minCount 个插件的意图不展示。
 * 按覆盖数降序；一次性 O(意图数 × 插件数)，9k × ~100 在首页加载时约百毫秒级。
 */
export function buildZhFacets<T extends FacetablePlugin>(
  plugins: T[],
  minCount = 3
): ZhFacet<T>[] {
  // 每个插件的小写字段只算一次（104 意图 × 9k 插件重复 toLowerCase 得不偿失）
  const lowered = new Map<T, { name: string; full: string; tags: string[] }>();
  for (const p of plugins) {
    lowered.set(p, {
      name: p.name.toLowerCase(),
      full: p.fullName.toLowerCase(),
      tags: p.tags.map((t) => t.toLowerCase()),
    });
  }
  const out: ZhFacet<T>[] = [];
  for (const it of ZH_INTENTS) {
    const strong: T[] = [];
    for (const p of plugins) {
      const l = lowered.get(p)!;
      const tier = matchTerms(l.name, l.full, l.tags, null, it.terms);
      if (tier === "strong") strong.push(p);
    }
    if (strong.length >= minCount) {
      strong.sort((a, b) => facetScoreOf(b) - facetScoreOf(a));
      out.push({ key: it.key, count: strong.length, plugins: strong });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}
