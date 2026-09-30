/**
 * #185 · 详情页深链（查询参数路由）
 *
 * 卡片渲染为真实 <a href>：右键「在新标签页打开」/ 中键 / Ctrl+点击 由浏览器原生处理；
 * 普通左键由 App 拦截（isPlainLeftClick）做 SPA 跳转，保持即时切换与滚动恢复（#103）。
 *
 * 选用查询参数（?plugin=…）而非 hash 路由：GitHub Pages 零配置，且不与页内
 * #锚点（#market / #pack-list）抢占 hash 语义；location.pathname 保证子路径部署可用。
 */

export type DeepLink = { plugin?: string; pack?: string; view?: string };

/** 插件详情深链：?plugin=<id>（id 形如 owner/repo，经 encodeURIComponent 转义） */
export function pluginDetailUrl(id: string): string {
  return `${location.pathname}?plugin=${encodeURIComponent(id)}`;
}

/** 整合包详情深链：?pack=<id> */
export function packDetailUrl(id: string): string {
  return `${location.pathname}?pack=${encodeURIComponent(id)}`;
}

/** 评分体系深链：?view=guide */
export function guideUrl(): string {
  return `${location.pathname}?view=guide`;
}

/** 从 location.search（或传入的 search 串）解析深链参数 */
export function parseDeepLink(search?: string): DeepLink {
  const q = new URLSearchParams(search ?? location.search);
  return {
    plugin: q.get("plugin") ?? undefined,
    pack: q.get("pack") ?? undefined,
    view: q.get("view") ?? undefined,
  };
}

/** 是否为「无修饰键的普通左键」：是 → SPA 拦截；否（中键/Ctrl/⌘/Shift）→ 交给浏览器新开标签页/窗口 */
export function isPlainLeftClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
