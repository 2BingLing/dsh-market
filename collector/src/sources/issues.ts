/**
 * 数据源 4：本仓库提交插件 issue（label: submission）
 * 原理：读取 open issues 正文 → 正则提取 github.com/owner/repo → 并入候选池
 * 不关闭 issue、不评论（纯只读）；最终收录与否由特征检测决定。
 */

import { githubFetch } from "../github.js";
import {
  DATA_FIX_TITLE_RE,
  extractCorrections,
  extractRepoFromDataFixText,
  mergeCorrections,
  type DataCorrections,
} from "./corrections.js";

/** 本仓库（提交插件 issue 所在） */
const MARKET_REPO = "2BingLing/dsh-market";
const SUBMISSION_LABEL = "submission";

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels?: Array<{ name?: string }>;
  user?: { login?: string };
}

/** 从 issue 正文提取 GitHub 仓库地址（兼容多种写法） */
export function extractRepoFromText(text: string): string[] {
  const out: string[] = [];
  // 匹配 github.com/owner/repo（支持 /tree/ /blob/ /issues/ 等后缀）
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1].toLowerCase();
    const repo = m[2].toLowerCase().replace(/\.git$/, "");
    // 过滤明显非仓库路径（如 github.com 自身、market 仓库自己、GitHub 附件域）
    if (owner === "github" || owner === "2bingling" || owner === "user-attachments") continue;
    if (repo === "issues" || repo === "settings" || repo === "marketplace") continue;
    const fn = `${owner}/${repo}`;
    if (!out.includes(fn)) out.push(fn);
  }
  return out;
}

/** 从 issue 正文提取「作者自述简介」（模板字段：**作者自述简介**：…），取一行
 * 兼容 markdown 加粗（**作者自述**：/ **自定义简介**：）与裸写法（作者自述：） */
export function extractIntroByAuthor(body: string | null): string | undefined {
  if (!body) return undefined;
  // 1) 方括号形式（模板推荐写法，可多行）
  const braced = body.match(
    /(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:]\s*\[([\s\S]*?)\]/m
  );
  if (braced) {
    const text = braced[1].trim();
    if (text) return text;
  }
  // 2) 裸写法（单行）
  const plain = body.match(
    /(?:作者自述|自定义简介|作者自述简介)\s*\*{0,2}\s*[：:]\s*([^\n\r]+)/
  );
  const text = plain?.[1]?.trim();
  return text || undefined;
}

/** 提交插件 issue 的提取结果 */
export interface SubmissionMeta {
  issueNumbers: number[];
  /** 作者自述简介（可选） */
  introByAuthor?: string;
  /** 数据修正（来自 `[数据修正]` issue）：作者自述清空 / 简介修正 */
  corrections?: DataCorrections;
  /** 子目录提示（#295：插件本体在仓库子目录，正文常自述「子目录 `xxx/`」） */
  subdirHints?: string[];
}

/**
 * 提交/修正 issue 的标题前缀（README「已收录插件可提交 `[数据修正]` issue 补写作者自述」，
 * CONTRIBUTING 同款说明）——`[数据修正]` 必须一并识别，否则补写的自述永远不会被读到。
 * #276/#279/#280 教训：英文用户常用 `[Plugin]` 起标题（而非模板的 `[提交插件]`），
 * 白名单缺 `plugin` 会让没打 submission 标签的提交静默漏收，故补上（`plugins?` 兼容复数）。
 */
export const SUBMISSION_TITLE_RE =
  /^\[(提交插件|提交工具|数据修正|submit|plugins?|plugin submission)\]/i;

/** 读取本仓库所有 open 的提交插件 issue：返回 fullName(lower) → 元数据（issue 号 + 作者自述） */
export async function fetchSubmissionRepos(): Promise<Map<string, SubmissionMeta>> {
  return fetchSubmissionReposBy(SUBMISSION_TITLE_RE, "submission", "issues:submission");
}

/** 读取本仓库所有 open 的提交整合包 issue（[提交整合包] 标题）→ fullName(lower) → issue 号列表 */
export async function fetchPackSubmissionRepos(): Promise<Map<string, number[]>> {
  return fetchSubmissionReposByPack(/^\[提交整合包\]|^\[submit pack/i, "submission", "issues:pack-submission");
}

/** #306/#311 · 标题白名单（无括号冒号式与全角标题式）：
 *  - `Plugin submission: dsh-constitution-seed`（英文用户不套方括号，冒号直排）
 *  - `【收录申请】批量收录 …`（全角括号批量通道） */
export const SUBMISSION_TITLE_LOOSE_RE =
  /^\s*(?:plugins?\s+submission\s*[:：]|【\s*收录(?:申请)?\s*】)/i;

/** #311 · 批量收录申请标题（正文是编号清单，走 extractBatchRepos 提取） */
export const BATCH_SUBMISSION_TITLE_RE = /【\s*收录申请\s*】|批量收录/;

/** 从提交正文提取子目录提示（#295：「插件本体在子目录 `cyrene-balance-widget/`」）。
 *  识别反引号包裹、以 / 结尾的相对路径 token；URL（含 //）排除。 */
export function extractSubdirHints(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\s]+)\/`/g)) {
    const p = m[1];
    if (!p || p.includes("//") || /^https?$/i.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** #311 · 批量收录申请：从编号清单（`1. dsh-xxx — 简介`）提取包名，
 *  结合 owner 构造 owner/repo 候选。owner 来源：正文里的 github.com/<owner>
 *  （批量提交常只给一个主页链接），否则 issue 作者 login。
 *  名字合法性：字母数字开头 + [\w.-]，长度 ≥ 3；404 仓库由后续检测阶段自然拒绝。 */
export function extractBatchRepos(text: string, authorLogin: string): string[] {
  const ownerM = text.match(/github\.com\/([A-Za-z0-9_.-]+)(?:\/|$|\s)/);
  const owner = (ownerM?.[1] ?? authorLogin).toLowerCase();
  if (!owner || ["github", "user-attachments"].includes(owner)) return [];
  const out: string[] = [];
  for (const m of text.matchAll(
    /^\s*(?:\d+[.、)]|[-*+])\s*`?([A-Za-z0-9][a-zA-Z0-9_.-]{2,})`?\s*(?:$|[—–:：])/gm,
  )) {
    const name = m[1].toLowerCase();
    const fn = `${owner}/${name}`;
    if (!out.includes(fn)) out.push(fn);
  }
  return out;
}

async function fetchSubmissionReposBy(
  titleRe: RegExp,
  label: string,
  logTag: string
): Promise<Map<string, SubmissionMeta>> {
  const out = new Map<string, SubmissionMeta>();
  try {
    // label 过滤 + 标题前缀兜底（未打 label 的存量/模板失效 issue 也能命中）
    const issues = await githubFetch<GithubIssue[]>(
      `/repos/${MARKET_REPO}/issues?state=open&per_page=100`
    );
    let counted = 0;
    for (const issue of issues) {
      const isSubmission =
        (issue.labels ?? []).some((l: { name?: string }) => l.name === label) ||
        titleRe.test(issue.title) ||
        SUBMISSION_TITLE_LOOSE_RE.test(issue.title);
      if (!isSubmission) continue;
      counted++;
      const text = `${issue.title}\n${issue.body ?? ""}`;
      const introByAuthor = extractIntroByAuthor(issue.body ?? null);
      // `[数据修正]` issue 走宽松解析：自由书写的方括号自述（#135 风格）+ 简介修正 + 安装命令修正；
      // 正文常只写反引号包裹的裸 `owner/repo`（如 #135），严格 URL 提取为空时用裸写法兜底
      const isDataFix = DATA_FIX_TITLE_RE.test(issue.title);
      const corrections = isDataFix ? extractCorrections(issue.body ?? null) : undefined;
      const subdirHints = extractSubdirHints(text);
      let fromText = extractRepoFromText(text);
      if (fromText.length === 0 && isDataFix) fromText = extractRepoFromDataFixText(text);
      // #311 · 批量收录申请：编号清单只有裸包名（无 URL）→ owner 取正文主页链接或 issue 作者；
      // 与 URL 提取结果取并集（混合格式：部分给了链接、部分只有编号清单）
      if (BATCH_SUBMISSION_TITLE_RE.test(issue.title)) {
        fromText = [...new Set([...fromText, ...extractBatchRepos(text, issue.user?.login ?? "")])];
      }
      const fns = fromText;
      for (const fn of fns) {
        const meta = out.get(fn) ?? { issueNumbers: [] };
        if (!meta.issueNumbers.includes(issue.number)) meta.issueNumbers.push(issue.number);
        meta.introByAuthor = meta.introByAuthor ?? introByAuthor;
        meta.corrections = mergeCorrections(meta.corrections, corrections);
        if (subdirHints.length) {
          meta.subdirHints = [...new Set([...(meta.subdirHints ?? []), ...subdirHints])];
        }
        out.set(fn, meta);
      }
    }
    console.log(`  ${logTag} -> ${counted} issues, ${out.size} repos`);
    return out;
  } catch (err) {
    // 失败不阻断主流程（issues 只是补充源）
    console.warn(`  issues scan failed: ${(err as Error).message}`);
    return out;
  }
}

async function fetchSubmissionReposByPack(
  titleRe: RegExp,
  label: string,
  logTag: string
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  try {
    const issues = await githubFetch<GithubIssue[]>(
      `/repos/${MARKET_REPO}/issues?state=open&per_page=100`
    );
    let counted = 0;
    for (const issue of issues) {
      const isSubmission =
        (issue.labels ?? []).some((l: { name?: string }) => l.name === label) ||
        titleRe.test(issue.title);
      if (!isSubmission) continue;
      counted++;
      const text = `${issue.title}\n${issue.body ?? ""}`;
      for (const fn of extractRepoFromText(text)) {
        const list = out.get(fn) ?? [];
        if (!list.includes(issue.number)) list.push(issue.number);
        out.set(fn, list);
      }
    }
    console.log(`  ${logTag} -> ${counted} issues, ${out.size} repos`);
    return out;
  } catch (err) {
    console.warn(`  issues scan failed: ${(err as Error).message}`);
    return out;
  }
}
