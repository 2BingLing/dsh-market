/**
 * 中文标签体系（§5.3 第二层）共享匹配器——2026-09-29 实现下沉到 schema 包
 * （web 与插件端共用同一份强弱信号定义与 facets 构建，杜绝三端分叉）。
 * 本文件保留为 re-export 垫片：web 内部（zh-search / App / TagPanel）的既有导入路径不变。
 */
export { matchTerms, buildZhFacets, intentTerms, facetScoreOf } from "@dsh-market/schema/zh-taxonomy";
export type { MatchTier, ZhFacet, FacetablePlugin } from "@dsh-market/schema/zh-taxonomy";
