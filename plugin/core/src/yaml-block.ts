/**
 * pnpm-workspace.yaml 最小编辑器（P0-2/P0-3 共用）
 *
 * 需求只覆盖三种简单结构，因此不引入 YAML 依赖，用行级编辑而非全量解析：
 *   1. 数组块：`key:` + `  - item`（如 onlyBuiltDependencies）
 *   2. map 真值块：`key:` + `  item: true`（如 allowBuilds）
 *   3. 标量：`key: value`（如 minimumReleaseAge）
 *
 * 原则：保留未涉及内容原样；只在目标块内做增量合并，绝不整体重写文件。
 * 纯函数，可独立测试。
 */

/** 数组块：往 `key:` 块中合并条目（去重保留；无块则追加到文件末尾） */
export function mergeListBlock(yaml: string, key: string, items: string[]): string {
  const want = [...new Set(items.map((i) => i.trim()).filter(Boolean))];
  if (want.length === 0) return yaml;
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);

  if (idx === -1) {
    const cleaned = yaml.replace(/\s+$/g, "");
    return (
      (cleaned ? cleaned + "\n" : "") +
      `${key}:\n` +
      want.map((i) => `  - ${i}`).join("\n") +
      "\n"
    );
  }

  const { childStart, childEnd } = blockRange(lines, idx);
  const existing = lines
    .slice(childStart, childEnd)
    .map((l) => l.trim().replace(/^-\s+/, ""))
    .filter((l) => l.length > 0)
    .map(normalizeKey);
  const merged = [...new Set([...existing, ...want])];
  const newContent = `${key}:\n` + merged.map((i) => `  - ${i}`).join("\n");
  return rebuildBlock(lines.slice(0, idx), newContent, lines.slice(childEnd));
}

/** map 真值块：往 `key:` 块中合并 `item: true` 条目（如 allowBuilds） */
export function mergeTrueMapBlock(yaml: string, key: string, items: string[]): string {
  const want = [...new Set(items.map((i) => i.trim()).filter(Boolean))];
  if (want.length === 0) return yaml;
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);

  if (idx === -1) {
    const cleaned = yaml.replace(/\s+$/g, "");
    return (
      (cleaned ? cleaned + "\n" : "") +
      `${key}:\n` +
      want.map((i) => `  ${i}: true`).join("\n") +
      "\n"
    );
  }

  const { childStart, childEnd } = blockRange(lines, idx);
  const existing = lines
    .slice(childStart, childEnd)
    .map((l) => l.trim().replace(/:\s*(true|false)?\s*$/, ""))
    .filter((l) => l.length > 0)
    .map(normalizeKey);
  const merged = [...new Set([...existing, ...want])];
  const newContent = `${key}:\n` + merged.map((i) => `  ${i}: true`).join("\n");
  return rebuildBlock(lines.slice(0, idx), newContent, lines.slice(childEnd));
}

/**
 * 重组：prefix(块前原内容) + 新块 + tail(块后原内容)。
 * 新块固定以换行收尾；tail 前导空行压缩为单个空行分隔。
 */
function rebuildBlock(prefix: string[], newContent: string, tail: string[]): string {
  const head = prefix.join("\n");
  const tailText = tail.join("\n").replace(/^\n+/, "");
  let out = (head ? head + "\n" : "") + newContent;
  if (tailText) {
    out += "\n\n" + tailText;
    if (!out.endsWith("\n")) out += "\n";
  } else {
    out += "\n";
  }
  return out;
}

/** 标量：设置 `key: value`（已存在则替换该行，否则追加到末尾） */
export function setScalar(yaml: string, key: string, value: string | number): string {
  const v = String(value);
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);
  if (idx !== -1) {
    lines[idx] = `${key}: ${v}`;
    return lines.join("\n");
  }
  const cleaned = yaml.replace(/\s+$/g, "");
  return (cleaned ? cleaned + "\n" : "") + `${key}: ${v}\n`;
}

/** 标量：读取 `key: value` 的值（无或非标量返回 null） */
export function getScalar(yaml: string, key: string): string | null {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);
  if (idx === -1) return null;
  const rest = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  if (!rest || rest === "" || rest.startsWith("#")) return null;
  return rest;
}

/** 数组块：读取 `key:` 下的条目（含内联形态 `key: [a, b]`） */
export function getListBlock(yaml: string, key: string): string[] {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);
  if (idx === -1) return [];
  const inline = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/["']/g, ""))
      .filter(Boolean)
      .map(normalizeKey);
  }
  const { childStart, childEnd } = blockRange(lines, idx);
  return lines
    .slice(childStart, childEnd)
    .map((l) => l.trim().replace(/^-\s+/, ""))
    .filter((l) => l.length > 0)
    .map(normalizeKey);
}

/** map 真值块：读取 `key:` 下的键名（形如 `  name: true`） */
export function getTrueMapBlock(yaml: string, key: string): string[] {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^[A-Za-z0-9_-]+:/.test(l) && l.split(":")[0] === key);
  if (idx === -1) return [];
  const inline = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  // 内联 map 形态 `key: { a: true }`
  if (inline.startsWith("{") && inline.endsWith("}")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((s) => s.split(":")[0].trim().replace(/["']/g, ""))
      .filter(Boolean)
      .map(normalizeKey);
  }
  const { childStart, childEnd } = blockRange(lines, idx);
  return lines
    .slice(childStart, childEnd)
    .map((l) => l.trim().split(":")[0].trim().replace(/["']/g, ""))
    .filter((l) => l.length > 0 && l !== "-")
    .map(normalizeKey);
}

/** 块范围：key 行之后连续的缩进子行 */
function blockRange(lines: string[], idx: number): { childStart: number; childEnd: number } {
  let childStart = idx + 1;
  let childEnd = childStart;
  while (childEnd < lines.length) {
    const l = lines[childEnd];
    if (l.trim() === "" || /^\s*\//.test(l)) {
      childEnd++;
      continue;
    }
    if (/^\s+/.test(l)) {
      childEnd++;
      continue;
    }
    break;
  }
  return { childStart, childEnd };
}

/** 归一化 key：去版本号/引号/空白，小写（用于去重） */
function normalizeKey(s: string): string {
  return s
    .trim()
    .replace(/["']/g, "")
    .replace(/@\d[\w.\-+]*$/, "")
    .toLowerCase();
}
