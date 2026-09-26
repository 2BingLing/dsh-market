/**
 * Web 端中文意图搜索（§5.3 第一层的 web 侧接入）
 *
 * 与插件端 core/search.ts 同思路：中文意图词典把口语查询扩展成召回词
 * （搜「记事本」→ notes/memo/笔记…），解决"字面不相交但语义相同"的召回空洞。
 * 词表来自 @dsh-market/schema/zh-intent（与插件端共用同一份，schema 为唯一真值）。
 *
 * 合并语义（实测 8.4k 条目校准，见 2026-09-26 冒烟）：
 *   - 主查询精确命中全保留（哪怕只有 1 条——它确实包含查询字面）；
 *   - 意图扩展**加性**追加（去重）：强信号（标签精确 / 名称含召回词）全收，
 *     弱信号（简介子串）仅当强信号 < 15 条时补位——"note" 这类短词在描述里
 *     到处命中，无限流会把 660 条噪声灌进结果（全局按分数重排后淹没真货）；
 *   - 扩展总量封顶 60；主 + 扩展皆空 → Fuse 模糊兜底（不标意图）。
 */
import Fuse from "fuse.js";
import type { DshPlugin } from "@dsh-market/schema";
import { expandZhQuery } from "@dsh-market/schema/zh-intent";

export interface ZhAwareSearch {
  list: DshPlugin[];
  /** 命中的意图 key（词典顺序，UI 提示用） */
  intents: string[];
  /** 经意图扩展召回的结果数（0 = 本次没有走扩展层） */
  expandedCount: number;
}

function haystackOf(p: DshPlugin): string {
  return (
    p.name.toLowerCase() +
    " " +
    p.fullName.toLowerCase() +
    " " +
    (p.descriptionZh ?? "").toLowerCase() +
    " " +
    (p.description ?? "").toLowerCase() +
    " " +
    p.tags.map((t) => t.toLowerCase()).join(" ")
  );
}

/** 扩展召回的总量上限 */
const EXPANDED_CAP = 60;
/** 强信号（标签精确/名称命中）少于此数时，用简介子串弱信号补位 */
const STRONG_FLOOR = 15;

/**
 * 混合搜索：主查询包含匹配 + 中文意图扩展加性合并 → Fuse 模糊兜底。
 * 返回结果列表 + 命中意图 + 扩展贡献数；查询为空时原样返回列表。
 */
export function searchWithZhIntent(
  list: DshPlugin[],
  q: string,
  fuse: Fuse<DshPlugin>
): ZhAwareSearch {
  const ql = q.trim().toLowerCase();
  if (!ql) return { list, intents: [], expandedCount: 0 };
  const zh = expandZhQuery(q);

  // 1. 主查询快速包含匹配（名称/作者·仓库名/中英简介/标签），名称前缀优先
  const main = list.filter(
    (p) =>
      p.name.toLowerCase().includes(ql) ||
      p.fullName.toLowerCase().includes(ql) ||
      (p.descriptionZh ?? "").toLowerCase().includes(ql) ||
      (p.description ?? "").toLowerCase().includes(ql) ||
      p.tags.some((t) => t.toLowerCase().includes(ql))
  );
  main.sort((a, b) => {
    const rank = (p: DshPlugin) =>
      p.name.toLowerCase() === ql ? 0 : p.name.toLowerCase().startsWith(ql) ? 1 : 2;
    return rank(a) - rank(b) || b.score.total - a.score.total;
  });

  // 2. 中文意图扩展：加性合并（去重），分层限流
  let expanded: DshPlugin[] = [];
  if (zh.terms.length > 0) {
    const inMain = new Set(main.map((p) => p.id));
    const strong: DshPlugin[] = [];
    const weak: DshPlugin[] = [];
    for (const p of list) {
      if (inMain.has(p.id)) continue;
      const hay = haystackOf(p);
      const tagHit = zh.terms.some((t) => p.tags.includes(t));
      const nameHit = zh.terms.some(
        (t) => p.name.toLowerCase().includes(t) || p.fullName.toLowerCase().includes(t)
      );
      if (tagHit || nameHit) strong.push(p);
      else if (zh.terms.some((t) => hay.includes(t))) weak.push(p);
    }
    strong.sort((a, b) => b.score.total - a.score.total);
    weak.sort((a, b) => b.score.total - a.score.total);
    expanded =
      strong.length >= STRONG_FLOOR
        ? strong.slice(0, EXPANDED_CAP)
        : [...strong, ...weak].slice(0, EXPANDED_CAP);
  }

  // 3. 主 + 扩展皆空 → Fuse 模糊兜底（不标意图）
  if (main.length === 0 && expanded.length === 0) {
    return { list: fuse.search(ql).map((r) => r.item), intents: [], expandedCount: 0 };
  }
  return {
    list: main.length > 0 ? [...main, ...expanded] : expanded,
    intents: zh.intents,
    expandedCount: expanded.length,
  };
}
