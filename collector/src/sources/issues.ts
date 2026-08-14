/**
 * 数据源 4：本仓库提交插件 issue（label: submission）
 * 原理：读取 open issues 正文 → 正则提取 github.com/owner/repo → 并入候选池
 * 不关闭 issue、不评论（纯只读）；最终收录与否由特征检测决定。
 */

import { githubFetch } from "../github.js";

/** 本仓库（提交插件 issue 所在） */
const MARKET_REPO = "2BingLing/dsh-market";
const SUBMISSION_LABEL = "submission";

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels?: Array<{ name?: string }>;
}

/** 从 issue 正文/标题提取 GitHub 仓库地址（兼容多种写法） */
export function extractRepoFromText(text: string): string[] {
  const out: string[] = [];
  // 匹配 github.com/owner/repo（支持 /tree/ /blob/ /issues/ 等后缀）
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1].toLowerCase();
    const repo = m[2].toLowerCase().replace(/\.git$/, "");
    // 过滤明显非仓库路径（如 github.com 自身、market 仓库自己）
    if (owner === "github" || owner === "2bingling") continue;
    if (repo === "issues" || repo === "settings" || repo === "marketplace") continue;
    const fn = `${owner}/${repo}`;
    if (!out.includes(fn)) out.push(fn);
  }
  return out;
}

/** 读取本仓库所有 open 的提交插件 issue：返回 fullName(lower) → 对应 issue 号列表 */
export async function fetchSubmissionRepos(): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  try {
    // label 过滤 + 标题前缀兜底（未打 label 的存量/模板失效 issue 也能命中）
    const issues = await githubFetch<GithubIssue[]>(
      `/repos/${MARKET_REPO}/issues?state=open&per_page=100`
    );
    let counted = 0;
    for (const issue of issues) {
      const isSubmission =
        (issue.labels ?? []).some((l: { name?: string }) => l.name === SUBMISSION_LABEL) ||
        /^\[提交插件\]|^\[submit/i.test(issue.title);
      if (!isSubmission) continue;
      counted++;
      const text = `${issue.title}\n${issue.body ?? ""}`;
      for (const fn of extractRepoFromText(text)) {
        const list = out.get(fn) ?? [];
        if (!list.includes(issue.number)) list.push(issue.number);
        out.set(fn, list);
      }
    }
    console.log(`  issues:submission -> ${counted} issues, ${out.size} repos`);
    return out;
  } catch (err) {
    // 失败不阻断主流程（issues 只是补充源）
    console.warn(`  issues scan failed: ${(err as Error).message}`);
    return out;
  }
}
