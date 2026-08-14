/**
 * GitHub API 客户端（纯 Node，token 由 UI 层注入）
 * - GET /user：取当前用户 login（设备流/PAT 绑定后验证身份）
 * - GET /user/starred：取用户全部加星（PAT 可用；GitHub App 令牌不可用此端点）
 * - GET /users/{username}/starred：取用户公开加星（任意 token 甚至无 token 可用）
 */
import type { DshPlugin } from "@dsh-market/schema";

const API_BASE = "https://api.github.com";
const PER_PAGE = 100;

export interface GitHubUser {
  login: string;
  avatar_url: string | null;
}

/** 获取当前用户信息（需有效 token） */
export async function fetchCurrentUser(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubUser> {
  const res = await fetchImpl(`${API_BASE}/user`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "dsh-market" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub /user ${res.status}`);
  const d = (await res.json()) as GitHubUser;
  return { login: d.login, avatar_url: d.avatar_url };
}

/**
 * 拉取加星仓库 fullName 列表
 * @param token 可选：有 token 走 /user/starred（含私有加星，GitHub App 令牌不可用）；
 *              无 token 时用 username 走 /users/{username}/starred（仅公开）
 */
export async function fetchStarred(
  opts: { token?: string; username?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const { token, username } = opts;
  if (!token && !username) return [];
  const base = token
    ? `${API_BASE}/user/starred`
    : `${API_BASE}/users/${encodeURIComponent(username!)}/starred`;
  const headers: Record<string, string> = { "User-Agent": "dsh-market" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: string[] = [];
  let page = 1;
  // 公开加星可能几千条，限制拉取页数保护配额（默认最多 10 页 = 1000 条）
  const maxPages = 10;
  for (; page <= maxPages; page++) {
    const res = await fetchImpl(
      `${base}?per_page=${PER_PAGE}&page=${page}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) throw new Error(`GitHub starred ${res.status}`);
    const arr = (await res.json()) as Array<{ full_name: string }>;
    if (!arr.length) break;
    for (const r of arr) out.push(r.full_name);
    if (arr.length < PER_PAGE) break;
  }
  return out;
}

/** 加星仓库中命中市场收录的插件 id 列表 */
export function starredPluginIds(
  starredFullNames: string[],
  market: DshPlugin[],
): string[] {
  const lower = new Set(starredFullNames.map((s) => s.toLowerCase()));
  return market
    .filter(
      (p) => lower.has(p.fullName.toLowerCase()) || lower.has(p.id.toLowerCase()),
    )
    .map((p) => p.id);
}
