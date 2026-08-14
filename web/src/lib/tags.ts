/**
 * 标签治理：从插件数据聚合可用的功能标签
 * - 过滤宽泛无区分度的标签（80%+ 插件都有 = 没有筛选价值）
 * - 返回按出现次数排序的标签列表
 */
import type { DshPlugin } from "@dsh-market/schema";

/** 宽泛标签黑名单：这些标签覆盖绝大多数插件，对筛选无意义 */
const GENERIC_TAGS = new Set([
  "效率工具",
  "开发辅助",
  "AI 增强",
  "AI增强",
]);

export interface TagStat {
  tag: string;
  count: number;
}

/** 聚合所有插件的细分中文标签（过滤宽泛标签） */
export function aggregateTags(plugins: DshPlugin[]): TagStat[] {
  const counts = new Map<string, number>();
  for (const p of plugins) {
    for (const t of p.tags) {
      if (!/[\u4e00-\u9fff]/.test(t)) continue; // 只收中文功能标签
      if (GENERIC_TAGS.has(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/** 热门标签（前 N 个，默认 12） */
export function hotTags(plugins: DshPlugin[], n = 12): TagStat[] {
  return aggregateTags(plugins).slice(0, n);
}

/** 判断插件是否包含全部选中标签（AND 语义） */
export function matchesTags(plugin: DshPlugin, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.every((t) => plugin.tags.includes(t));
}

/** 插件与标签集合的匹配数（用于推荐排序） */
export function tagMatchCount(plugin: DshPlugin, selected: string[]): number {
  return selected.filter((t) => plugin.tags.includes(t)).length;
}
