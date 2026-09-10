/**
 * 数据修正检测：解析 `[数据修正]` issue 正文 → 结构化修正指令
 *
 * 已收录插件用 `[数据修正]` issue 修正数据，支持三类：
 *   - 作者自述：方括号自由书写（无需前置字段名，兼容 #135 的自由叙事写法），
 *     `作者自述：无/删除/清除/清空/去掉` 显式清空已收录自述（作者无法删除的取舍，见 PR #136）
 *   - 简介/文案：`简介：`/`一句话简介：`/`修正简介：`/`描述：`/`文案：` 后文本 → 覆盖中文简介 descriptionZh
 *   - 安装命令：`安装命令：`/`安装：` 后文本（或 ```sh 代码块）→ 覆盖 install.commands
 * 类型等复杂修正：README/CONTRIBUTING 注明建议直接重提 [提交插件] issue
 */
export interface DataCorrections {
  /** 作者自述：undefined = 未提供；null = 显式清空（`作者自述：无` 等） */
  introByAuthor?: string | null;
  /** 中文简介/文案修正（写入 descriptionZh） */
  descriptionZh?: string;
  /** 安装命令修正（写入 install.commands） */
  installCommands?: string[];
}

/** `[数据修正]` 标题前缀（与 SUBMISSION_TITLE_RE 中该分支保持同一口径） */
export const DATA_FIX_TITLE_RE = /^\[(数据修正|data fix)\]/i;

// 显式清空：`作者自述：无/删除/清除/清空/去掉`（含后续说明文字；不设行尾锚点，
// “删除”等关键词紧跟字段名即视为清空意图——否则普通匹配会把“无/删除”当自述文本）
const CLEAR_INTRO_RE = /作者自述\s*\*{0,2}\s*[：:]\s*(?:无|删除|清除|清空|去掉)/;
const LABELED_INTRO_RE =
  /(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:]\s*\[([\s\S]*?)\]/;
const LABELED_INTRO_PLAIN_RE =
  /(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:]\s*([^\n\r]+)/;
const LABELED_DESC_RE = /(?:一句话简介|修正简介|简介|文案|描述)\s*[：:]\s*\[([\s\S]*?)\]/;
const LABELED_DESC_PLAIN_RE = /(?:一句话简介|修正简介|简介|文案|描述)\s*[：:]\s*([^\n\r]+)/;
const BRACKET_RE = /\[([\s\S]*?)\]/g;
/** 安装命令：优先取 ```sh / ```bash 代码块，其次 `安装命令：`/`安装：` 单行 */
const INSTALL_BLOCK_RE = /```(?:sh|bash|shell)\s*\n([\s\S]*?)```/g;
const INSTALL_LINE_RE = /(?:安装命令|安装)\s*\*{0,2}\s*[：:]\s*([^\n\r]+)/;

const FULLNAME_RE = /\b([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\b/g;

function clean(text: string): string {
  return text.replace(/^[\s\-*\u2022]+|[\s\-*\u2022]+$/g, "").trim();
}

/** 提取作者自述：undefined=未提供；null=显式清空；string=自述文本 */
function extractIntro(body: string): string | null | undefined {
  // 1) 显式清空优先（`作者自述：无` 若走普通匹配会被当成自述文本"无"）
  if (CLEAR_INTRO_RE.test(body)) return null;
  // 2) 带字段名的方括号（模板推荐写法）
  const labeled = body.match(LABELED_INTRO_RE);
  if (labeled) {
    const t = clean(labeled[1]);
    if (t) return t;
  }
  // 3) 自由书写兜底（#135 风格：正文里独立的大段方括号文本）——取最长方括号块，
  //    要求含中文且足够长，避免把 `[1]`、补丁链接等噪声当自述
  let best: string | undefined;
  for (const m of body.matchAll(BRACKET_RE)) {
    const t = clean(m[1]);
    if (t.length >= 30 && /[\u4e00-\u9fff]/.test(t) && (!best || t.length > best.length)) {
      best = t;
    }
  }
  if (best) return best;
  // 4) 裸写法（单行）
  const plain = body.match(LABELED_INTRO_PLAIN_RE);
  const t = clean(plain?.[1] ?? "");
  return t || undefined;
}

/** 提取中文简介/文案修正（先剥掉作者自述段，避免 `作者自述简介：` 里的 `简介` 被误命中） */
function extractDescriptionZh(body: string): string | undefined {
  const withoutIntro = body
    .replace(/(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:]\s*\[[\s\S]*?\]/g, "")
    .replace(/(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:][^\n\r]+/gm, "");
  const b = withoutIntro.match(LABELED_DESC_RE);
  if (b) {
    const t = clean(b[1]);
    if (t) return t;
  }
  const p = withoutIntro.match(LABELED_DESC_PLAIN_RE);
  const t = clean(p?.[1] ?? "");
  return t || undefined;
}

/** 提取安装命令修正：有效命令行需含包管理器/插件安装特征，避免把说明文本当命令 */
function extractInstallCommands(body: string): string[] | undefined {
  const hint = /(dsh plugin|npm(\s| |@|i | install| add)|pnpm|yarn add)/i;
  const candidates: string[] = [];
  for (const m of body.matchAll(INSTALL_BLOCK_RE)) {
    for (const line of (m[1] ?? "").split(/\r?\n/)) {
      const t = clean(line);
      if (t && hint.test(t)) candidates.push(t);
    }
  }
  const line = body.match(INSTALL_LINE_RE)?.[1];
  if (line) {
    const t = clean(line.split(/\r?\n/)[0]);
    if (t && hint.test(t) && !candidates.includes(t)) candidates.push(t);
  }
  return candidates.length > 0 ? candidates : undefined;
}

/**
 * 从 `[数据修正]` issue 正文提取目标仓库 fullName（裸写法兼容）：`github.com/owner/repo`
 * 之外的场景常只写反引号包裹的 `owner/repo`（如 #135 正文 `tr1v3r/dsh-quote-followup`）。
 * 数据修正针对的是「已收录插件」，取出现次数最多的 owner/repo，
 * 过滤纯数字/日期/文件路径等噪声；无候选返回空数组。
 */
export function extractRepoFromDataFixText(text: string): string[] {
  const counts = new Map<string, number>();
  // 先剥掉完整 URL（https://github.com/owner/repo 交给 extractRepoFromText 走严格解析），
  // 只剩裸 owner/repo 才在本函数匹配，避免把 `github.com`/`github.com/owner` 当候选
  const stripped = text.replace(/https?:\/\/[^\s)\]）>]+/gi, " ");
  for (const m of stripped.matchAll(FULLNAME_RE)) {
    const fn = m[1].toLowerCase();
    const [owner, repo] = fn.split("/");
    // 噪声过滤：owner/repo 都须含拉丁字母；排除纯数字段（2026/09/10）、太短、明显的仓库外路径
    if (!/[a-z]/i.test(owner) || !/[a-z]/i.test(repo)) continue;
    if (owner.length < 2 || repo.length < 2) continue;
    if (/^(github|github\.com|user-attachments|assets|docs|data|node_modules|src)$/i.test(owner)) continue;
    if (/\.(md|json|js|ts|yml|yaml|svg|png)$/i.test(repo)) continue;
    counts.set(fn, (counts.get(fn) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [fn, c] of counts) {
    if (c > bestCount) {
      best = fn;
      bestCount = c;
    }
  }
  return best ? [best] : [];
}

/** 解析 `[数据修正]` issue 正文 → 结构化修正指令（未提供任何修正返回空对象） */
export function extractCorrections(body: string | null): DataCorrections {
  if (!body) return {};
  const corr: DataCorrections = {};
  const intro = extractIntro(body);
  if (intro !== undefined) corr.introByAuthor = intro;
  const desc = extractDescriptionZh(body);
  if (desc) corr.descriptionZh = desc;
  const cmds = extractInstallCommands(body);
  if (cmds) corr.installCommands = cmds;
  return corr;
}

/** 逐字段合并修正（后到的 issue 覆盖先到的——体现作者最新意图；null 清空同样生效） */
export function mergeCorrections(
  base: DataCorrections | undefined,
  next: DataCorrections | undefined
): DataCorrections | undefined {
  if (
    !next ||
    (next.introByAuthor === undefined &&
      next.descriptionZh === undefined &&
      next.installCommands === undefined)
  ) {
    return base;
  }
  const out: DataCorrections = {
    introByAuthor:
      next.introByAuthor !== undefined ? next.introByAuthor : base?.introByAuthor,
    descriptionZh: next.descriptionZh ?? base?.descriptionZh,
    installCommands: next.installCommands ?? base?.installCommands,
  };
  return out;
}