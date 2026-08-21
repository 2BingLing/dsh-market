/**
 * 失效条目扫描（P0-D2 · 消肿通道）
 *
 * 每周扫描已收录插件，标记以下失效形态，只报不删（汇总到跟踪 issue 由人工处置）：
 *   gone     —— 仓库已删除（404）
 *   archived —— 仓库已归档（read-only）
 *   forked   —— 仓库已变成 fork（失去独立身份）
 *   dormant  —— 长期停更（pushedAt 距今超过阈值，默认 270 天）
 *   error    —— 探测失败（限流/网络），需下轮复查
 *
 * 设计原则（借鉴 awesome-dsh-plugin 的 decay-scan）：
 *   - 扫描从不自动移除任何条目，只产出报告；
 *   - 探测函数可注入（测试走 mock，生产走 GitHub API）；
 *   - 按 id 去重后并发探测，避免同一仓库重复请求。
 */
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import { runPool } from "./pool.js";

export type DecayKind = "gone" | "archived" | "forked" | "dormant" | "error";

export interface DecayFinding {
  id: string;
  fullName: string;
  kind: DecayKind;
  detail: string;
  stars: number;
  /** 最后推送时间（dormant 判定依据） */
  pushedAt: string | null;
  /** 停更天数（dormant 时给出） */
  days: number | null;
}

export interface DecayReport {
  generatedAt: string;
  checked: number;
  healthy: number;
  byKind: Partial<Record<DecayKind, number>>;
  findings: DecayFinding[];
}

/** GitHub repo 元数据的精简视图（探测函数返回） */
export interface RepoSnapshot {
  full_name?: string;
  archived?: boolean;
  fork?: boolean;
  pushed_at?: string;
  stargazers_count?: number;
}

export interface ScanDecayOpts {
  /** 仓库探测函数（注入便于测试；默认走 GitHub API） */
  fetchRepo?: (fullName: string) => Promise<RepoSnapshot | null>;
  /** 停更判定天数（默认 270） */
  dormantDays?: number;
  concurrency?: number;
}

/** 默认探测：GitHub API /repos/{fullName}；404 → null（已删除） */
export async function defaultFetchRepo(fullName: string): Promise<RepoSnapshot | null> {
  const { githubFetch } = await import("./github.js");
  try {
    const r = await githubFetch<RepoSnapshot>(`/repos/${fullName}`);
    return r;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    if (status === 403 || status === 429) {
      // 限流：让调用方标记为 error，不在这里长时间等待
      throw err;
    }
    throw err;
  }
}

export async function scanDecay(
  market: MarketData,
  opts: ScanDecayOpts = {},
): Promise<DecayReport> {
  const dormantDays = opts.dormantDays ?? 270;
  const concurrency = opts.concurrency ?? 10;
  const fetchRepo = opts.fetchRepo ?? defaultFetchRepo;

  // 按 id 去重（同仓库多路径/RESTORE 可能重复）
  const uniq = new Map<string, DshPlugin>();
  for (const p of market.plugins ?? []) {
    if (!uniq.has(p.id)) uniq.set(p.id, p);
  }
  const plugins = [...uniq.values()];
  const findings: DecayFinding[] = [];
  const now = Date.now();

  const worker = async (p: DshPlugin) => {
    const stale = (p: DshPlugin): DecayFinding => {
      const pushedAt = p.pushedAt ? new Date(p.pushedAt).getTime() : null;
      const days = pushedAt ? Math.floor((now - pushedAt) / 86_400_000) : null;
      return {
        id: p.id,
        fullName: p.fullName,
        kind: "dormant",
        detail: `长期停更（${days ?? "?"} 天无推送）`,
        stars: p.stars ?? 0,
        pushedAt: p.pushedAt ?? null,
        days,
      };
    };

    try {
      const repo = await fetchRepo(p.fullName);
      if (repo === null) {
        findings.push({
          id: p.id,
          fullName: p.fullName,
          kind: "gone",
          detail: "仓库已删除（404）",
          stars: p.stars ?? 0,
          pushedAt: p.pushedAt ?? null,
          days: null,
        });
        return;
      }
      // 仓库转移/改名：full_name 与收录 id 不一致 → 视为失效（新名由每日扫描重新收录）
      if (repo.full_name && repo.full_name.toLowerCase() !== p.fullName.toLowerCase()) {
        findings.push({
          id: p.id,
          fullName: p.fullName,
          kind: "gone",
          detail: `仓库已转移/改名（现值 ${repo.full_name}），应由每日扫描重新收录`,
          stars: p.stars ?? 0,
          pushedAt: p.pushedAt ?? null,
          days: null,
        });
        return;
      }
      if (repo.archived) {
        findings.push({
          id: p.id,
          fullName: p.fullName,
          kind: "archived",
          detail: "仓库已归档（只读）",
          stars: p.stars ?? 0,
          pushedAt: p.pushedAt ?? null,
          days: null,
        });
        return;
      }
      if (repo.fork) {
        findings.push({
          id: p.id,
          fullName: p.fullName,
          kind: "forked",
          detail: "仓库已成 fork（失去独立身份）",
          stars: p.stars ?? 0,
          pushedAt: p.pushedAt ?? null,
          days: null,
        });
        return;
      }
      if (repo.pushed_at) {
        const pushed = new Date(repo.pushed_at).getTime();
        if (now - pushed > dormantDays * 86_400_000) {
          findings.push({
            ...stale(p),
            pushedAt: repo.pushed_at,
            days: Math.floor((now - pushed) / 86_400_000),
          });
          return;
        }
      } else if (p.pushedAt) {
        // 探测未返回 pushed_at 时，退用收录数据的 pushedAt 判定
        const pushed = new Date(p.pushedAt).getTime();
        if (now - pushed > dormantDays * 86_400_000) {
          findings.push(stale(p));
          return;
        }
      }
      // 健康
    } catch (err) {
      findings.push({
        id: p.id,
        fullName: p.fullName,
        kind: "error",
        detail: `探测失败: ${(err as Error).message.slice(0, 80)}`,
        stars: p.stars ?? 0,
        pushedAt: p.pushedAt ?? null,
        days: null,
      });
    }
  };

  await runPool(plugins, worker, concurrency);

  const byKind: Partial<Record<DecayKind, number>> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    checked: plugins.length,
    healthy: plugins.length - findings.length,
    byKind,
    findings: findings.sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}
