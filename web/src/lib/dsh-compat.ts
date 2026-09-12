/**
 * DSH 宿主版本要求的展示格式化（Web 端 · N2）
 *
 * Web 端拿不到"用户本机 DSH 版本"（那是浏览器，无本机概念），所以这里**只做需求展示**，
 * 不做任何兼容判断——判断在插件端（core/compat.ts）用真实的本机版本完成。
 * 这正是本项目的分工：Web 说明"这插件要什么"，插件端回答"你装得上吗"。
 *
 * 只对最常见的几种范围做人性化渲染，其余原样展示（宁可显示原始范围，也不要瞎翻译）。
 */
export function formatDshRequirement(range: string | null | undefined): string | null {
  const raw = (range ?? "").trim();
  if (!raw || raw === "*" || raw === "x" || raw === "X") return null;
  const first = raw.split("||")[0]!.trim();
  const m = /^(>=|>|<=|<|=|==|\^|~)\s*(.+)$/.exec(first);
  if (!m) return `需要 DSH ${raw}`;
  const [, op, ver] = m;
  switch (op) {
    case ">=":
      return `需要 DSH ≥ ${ver}`;
    case ">":
      return `需要 DSH > ${ver}`;
    case "<=":
      return `需要 DSH ≤ ${ver}`;
    case "<":
      return `需要 DSH < ${ver}`;
    case "=":
    case "==":
      return `仅支持 DSH ${ver}`;
    case "^":
      return `需要 DSH ${ver} 同主次版本`;
    case "~":
      return `需要 DSH ≥ ${ver}（同次版本）`;
    default:
      return `需要 DSH ${raw}`;
  }
}
