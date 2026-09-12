/**
 * 版本与范围工具（N2 · Host-aware 兼容门禁的基础设施）
 *
 * 为什么自己写而不引 semver：core 层要保持「纯 Node + 零重依赖」（可独立测试、打包体积小），
 * 而这里只需要 semver 范围里最常见的一个子集。
 *
 * ⚠️ 与 `update.ts` 的关系（别混用）：
 *   - `update.ts` 的 `parseVersion` / `compareVersions` 做的是**标准 semver 排序**
 *     （要求三段版本号，且「正式版 > 预发布」按规范比较）——服务于"我该不该升级"。
 *   - 本模块的 `parseVersionForRange` / `compareVersionsForRange` 做的是**范围边界匹配**
 *     （容忍 1~2 段版本号，且**故意忽略预发布**）——服务于"这个插件能不能跑在我的宿主上"。
 *   两者语义不同，故意不合并。导出名带 ForRange 就是为了防止误用。
 *
 * ⚠️ 一处**故意的语义偏离**（务必先读懂再改）：
 *   标准 semver 规定「预发布版本不满足指向正式版的比较」——即 `0.1.5-rc.1` **不**满足 `>=0.1.5`。
 *   但 DSH 的宿主版本常态就是 `0.1.1-rc.2` / `0.1.5-rc.1` 这种 rc 形态。若照标准来，
 *   本机 `0.1.5-rc.1` 对上插件声明的 `>=0.1.5` 会判成"不兼容"→ 拦住一次其实能用的安装。
 *   而"错误地拦住"比"漏一次提醒"糟糕得多（用户会立刻失去信任）。
 *   → 因此本模块采用 **prerelease 宽容比较**：比较边界时只看 主.次.补 三元组，
 *     于是 `0.1.5-rc.1` 满足 `>=0.1.5`、`0.1.5-rc.1` 也满足 `^0.1.2`。
 *   代价：极少数"作者严格要求正式版"的场景会被放过（由 UI 提示，不阻断）。
 *   **不可判定时一律返回 null（未知），调用方必须按"未知"处理，绝不拦截。**
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（如 "rc.1"），无则 null —— 仅用于展示，不参与边界比较 */
  pre: string | null;
}

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** 解析版本；容忍 `v` 前缀、缺省 minor/patch（`1` → 1.0.0）、build metadata */
export function parseVersionForRange(input: string | null | undefined): ParsedVersion | null {
  if (typeof input !== "string") return null;
  const m = VERSION_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? 0 : Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
    pre: m[4] ?? null,
  };
}

function compareTriple(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** 比较两个版本（prerelease 宽容：只看三元组）。无法解析返回 null */
export function compareVersionsForRange(a: string, b: string): number | null {
  const pa = parseVersionForRange(a);
  const pb = parseVersionForRange(b);
  if (!pa || !pb) return null;
  return compareTriple(pa, pb);
}

/** 单个比较子句：`>=0.1.5` / `^0.1.2` / `~0.1.2` / `1.2.x` / `0.1.5` */
function matchClause(version: ParsedVersion, clause: string): boolean | null {
  const raw = clause.trim();
  if (!raw || raw === "*" || raw === "x" || raw === "X") return true;

  // 比较运算符优先（`<=` / `>=` 必须先于 `<` / `>` 匹配）
  const opMatch = /^(<=|>=|<|>|=|==)\s*(.+)$/.exec(raw);
  if (opMatch) {
    const bound = parseVersionForRange(opMatch[2]);
    if (!bound) return null;
    const cmp = compareTriple(version, bound);
    switch (opMatch[1]) {
      case "<=":
        return cmp <= 0;
      case ">=":
        return cmp >= 0;
      case "<":
        return cmp < 0;
      case ">":
        return cmp > 0;
      default:
        return cmp === 0;
    }
  }

  // caret：^0.1.2 → >=0.1.2 <0.2.0；^0.0.3 → >=0.0.3 <0.0.4（semver 的 0.x 规则）
  if (raw.startsWith("^")) {
    const base = parseVersionForRange(raw.slice(1));
    if (!base) return null;
    if (compareTriple(version, base) < 0) return false;
    const upper: ParsedVersion =
      base.major > 0
        ? { major: base.major + 1, minor: 0, patch: 0, pre: null }
        : base.minor > 0
          ? { major: 0, minor: base.minor + 1, patch: 0, pre: null }
          : { major: 0, minor: 0, patch: base.patch + 1, pre: null };
    return compareTriple(version, upper) < 0;
  }

  // tilde：~0.1.2 → >=0.1.2 <0.2.0；~0.1 → >=0.1.0 <0.2.0
  if (raw.startsWith("~")) {
    const body = raw.slice(1);
    const base = parseVersionForRange(body);
    if (!base) return null;
    if (compareTriple(version, base) < 0) return false;
    const upper: ParsedVersion = { major: base.major, minor: base.minor + 1, patch: 0, pre: null };
    return compareTriple(version, upper) < 0;
  }

  // 通配段：0.1.x / 0.1.* / 0.1 / 0.1.2
  // ⚠️ 刻意**不接受**裸预发布版本（如 `0.1.5-rc.1`）：它会被判为"不可判定"而不是"精确等于"。
  //    原因（2026-09-12 真实抽样得出）：插件作者把 DSH 版本写进 devDependencies 时，
  //    写的是"我开发时用的那个版本"（pin），**不是**"只兼容这个版本"的兼容性声明。
  //    实测 stars 前 60 的插件里，9/16 的约束是这种裸 pin —— 若按 semver 精确匹配来判定，
  //    会把大量其实能用的插件标成"不兼容"。按"未知"处理既安全又更贴近作者本意。
  const parts = raw.split(".");
  const isWild = (s: string) => s === "" || s === "*" || s === "x" || s === "X";
  const nums = parts.slice(0, 3).map((s) => (isWild(s) ? null : /^\d+$/.test(s) ? Number(s) : NaN));
  if (nums.some((n) => Number.isNaN(n as number))) return null;
  const [maj, min, pat] = [nums[0], nums[1] ?? null, nums[2] ?? null];
  if (maj === null) return true; // `x` / `*`
  if (version.major !== maj) return false;
  if (min === null) return true; // `0.x`
  if (version.minor !== min) return false;
  if (pat === null) return true; // `0.1.x`
  return version.patch === pat;
}

/**
 * 判断 `version` 是否满足 `range`。
 *
 * 支持：`*` / 比较运算符 / `^` / `~` / 通配段 / 空格与逗号表示 AND / `||` 表示 OR /
 *      `0.1.0 - 0.2.0` 连字符区间。
 * 返回 **null = 无法判定**（范围或版本不能被解析）——调用方必须按"未知"处理，不要当作 false。
 */
export function satisfiesRange(version: string | null | undefined, range: string | null | undefined): boolean | null {
  const v = parseVersionForRange(version);
  if (!v) return null;
  if (range === null || range === undefined) return null;
  const raw = range.trim();
  if (!raw) return null;

  const orGroups = raw.split("||");
  let sawUnknown = false;
  for (const group of orGroups) {
    const g = group.trim();
    if (!g) continue;

    // 连字符区间：`0.1.0 - 0.2.0`
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(g);
    if (hy) {
      const lo = parseVersionForRange(hy[1]);
      const hi = parseVersionForRange(hy[2]);
      if (!lo || !hi) {
        sawUnknown = true;
        continue;
      }
      if (compareTriple(v, lo) >= 0 && compareTriple(v, hi) <= 0) return true;
      continue;
    }

    const clauses = g.split(/[\s,]+/).filter(Boolean);
    let all = true;
    let unknown = false;
    for (const clause of clauses) {
      const r = matchClause(v, clause);
      if (r === null) {
        unknown = true;
        all = false;
        break;
      }
      if (!r) {
        all = false;
        break;
      }
    }
    if (unknown) sawUnknown = true;
    else if (all) return true;
  }
  // 全部子句都判过且没有命中：若过程中出现过"不可判定"，整体也算不可判定
  return sawUnknown ? null : false;
}

/** 把范围翻成人话（用于 UI 提示） */
export function describeRange(range: string | null | undefined): string {
  const raw = (range ?? "").trim();
  if (!raw || raw === "*" || raw === "x" || raw === "X") return "任意版本";
  const m = /^(>=|>|<=|<|=|==|\^|~)\s*(.+)$/.exec(raw.split("||")[0].trim());
  if (!m) return `DSH ${raw}`;
  const [, op, ver] = m;
  switch (op) {
    case ">=":
      return `DSH ≥ ${ver}`;
    case ">":
      return `DSH > ${ver}`;
    case "<=":
      return `DSH ≤ ${ver}`;
    case "<":
      return `DSH < ${ver}`;
    case "=":
    case "==":
      return `DSH ${ver}`;
    case "^":
      return `DSH ${ver} ~ 同主次版本`;
    case "~":
      return `DSH ≥ ${ver}（同次版本）`;
    default:
      return `DSH ${raw}`;
  }
}
