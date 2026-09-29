/**
 * 中文标签体系共享匹配器（实现在 schema/src/zh-taxonomy.ts，2026-09-29 下沉）。
 * 本文件保留为 re-export 垫片：插件端 UI 的「中文分类」chips 从这里导入，
 * 与 web 端 TagPanel / 搜索共用同一份词典与强弱信号定义。
 */
export { matchTerms, buildZhFacets, intentTerms, facetScoreOf } from "@dsh-market/schema/zh-taxonomy";
export type { MatchTier, ZhFacet, FacetablePlugin } from "@dsh-market/schema/zh-taxonomy";
