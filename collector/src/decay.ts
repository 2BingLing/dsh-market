/**
 * 失效条目扫描（P0-D2 · 消肿通道）
 *
 * 每周扫描已收录插件，标记以下失效形态，只报不删（汇总到跟踪 issue 由人工处置）：
 *   gone     —— 仓库已删除（404 / GraphQL NOT_FOUND）
 *   renamed  —— 仓库已改名/转移（新名可被每日扫描重新收录，处置方式是"重新收录"而非"移除"）
 *   archived —— 仓库已归档（read-only）
 *   forked   —— 仓库已变成 fork（失去独立身份）
 *   dormant  —— 长期停更（pushedAt 距今超过阈值，默认 270 天）
 *   error    —— 探测失败（限流/网络），需下轮复查
 *
 * 设计原则（借鉴 awesome-dsh-plugin 的 decay-scan）：
 *   - 扫描从不自动移除任何条目，只产出报告；
 *   - 探测函数可注入（测试走 mock，生产走 decay-probe.ts 的 GraphQL 批量探测）；
 *   - 按 id 去重后并发探测，避免同一仓库重复请求。
 *
 * 2026-09-12 事故修复（每周一 job 连续 4 次被 cancel）：
 *   - 删掉「7 天检测缓存短路」——data/cache 未入库，CI 全新 checkout 永远是空目录，
 *     这段优化在 CI **从不生效**，只是让人误以为很省（本地有效、线上零效果）；
 *   - 探测改由 decay-probe.ts 批量完成，这里只负责判定与汇总；
 *   - 新增 budgetMs 墙钟预算：超时即停并输出部分结果，保证 job 一定能在 timeout 前产出报告；
 *   - 新增 abortOnErrors：批量探测的 error 是"瞬间产生"的（不再 sleep 重试），
 *     不需要靠熔断来防挂死，可关掉熔断以保住"未覆盖也要如实标 error"的完整性。
 */
import type { DshPlugin, MarketData } from "@dsh-market/schema";

export type DecayKind = "gone" | "renamed" | "archived" | "forked" | "dormant" | "error";

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
  /** aborted（熔断提前终止）时无完整健康数 */
  healthy?: number;
  byKind: Partial<Record<DecayKind, number>>;
  findings: DecayFinding[];
  /** 是否因错误率过高提前熔断（只出了部分结果） */
  aborted?: boolean;
  /** 中止原因（aborted 时给出，便于日志与跟踪 issue 说明覆盖度） */
  abortedReason?: string;
  /** 批量探测覆盖度（decay-cli 填充；跟踪 issue 用它说明本轮到底覆盖了多少） */
  probe?: {
    requests: number;
    resolved: number;
    unprobed: number;
    rateLimited: boolean;
    budgetExceeded: boolean;
  };
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
  /** 进度回调（第 done 个时调用；可用于给 Actions 日志喂进度，避免 30 分钟零输出被误 cancel） */
  onProgress?: (done: number, total: number, errorCount: number) => void;
  /** 熔断阈值：错误数 ≥ max(此值, 总条数×比例) 时提前终止，输出部分结果 */
  abortErrors?: number;
  abortErrorRatio?: number;
  /** 是否启用错误熔断（默认 true）。批量探测路径建议 false：未覆盖的条目要如实标 error */
  abortOnErrors?: boolean;
  /** 墙钟预算（ms）：超出后停止发起新探测并输出部分结果；0/缺省 = 15 分钟 */
  budgetMs?: number;
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
  const concurrency = (opts.concurrency ?? Number(process.env.DECAY_CONCURRENCY)) || 5;
  const fetchRepo = opts.fetchRepo ?? defaultFetchRepo;
  const abortErrors = opts.abortErrors ?? 150;
  const abortErrorRatio = opts.abortErrorRatio ?? 0.15;
  const abortOnErrors = opts.abortOnErrors ?? true;
  const budgetMs = opts.budgetMs ?? (Number(process.env.DECAY_BUDGET_MS) || 15 * 60_000);
  const onProgress = opts.onProgress;

  // 按 id 去重（同仓库多路径/RESTORE 可能重复）
  const uniq = new Map<string, DshPlugin>();
  for (const p of market.plugins ?? []) {
    if (!uniq.has(p.id)) uniq.set(p.id, p);
  }
  const plugins = [...uniq.values()];
  const n = plugins.length;
  const findings: DecayFinding[] = [];
  const now = Date.now();
  const deadline = budgetMs > 0 ? now + budgetMs : Number.POSITIVE_INFINITY;

  // 熔断预算：错误数（error/网络/限流）累计超阈值即停
  const errors: string[] = [];
  let aborted = false;
  let abortedReason: string | undefined;
  let next = 0;
  const errorBudget = Math.max(abortErrors, Math.ceil(n * abortErrorRatio));
  const isAborted = () =>
    aborted ||
    Date.now() > deadline ||
    (abortOnErrors && errors.length >= errorBudget);

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
          detail: "仓库已删除或不可访问（GraphQL NOT_FOUND）",
          stars: p.stars ?? 0,
          pushedAt: p.pushedAt ?? null,
          days: null,
        });
        return;
      }
      // 仓库转移/改名：full_name 与收录 id 不一致 → 单列 renamed
      //（与 gone 分开：改名不是"死了"，处置是"重新收录"，混在一起会让维护者误删有效条目）
      if (repo.full_name && repo.full_name.toLowerCase() !== p.fullName.toLowerCase()) {
        findings.push({
          id: p.id,
          fullName: p.fullName,
          kind: "renamed",
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
      errors.push((err as Error).message.slice(0, 120));
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

  // 可熔断的并发池（runPool 不支持提前停 → 内联实现）
  async function run(): Promise<void> {
    const runners = Array.from({ length: Math.min(concurrency, n) }, async () => {
      while (!isAborted()) {
        const i = next++;
        if (i >= n) break;
        await worker(plugins[i]);
        if (isAborted()) {
          aborted = true;
        }
        if (onProgress) {
          const done = Math.min(next, n);
          if (done % 200 === 0 || done === n) {
            onProgress(done, n, errors.length);
          }
        }
      }
    });
    await Promise.all(runners);
    if (isAborted() && next < n) aborted = true;
  }
  await run();

  if (aborted) {
    if (Date.now() > deadline) abortedReason = `超出 ${Math.round(budgetMs / 1000)}s 时间预算`;
    else if (abortOnErrors && errors.length >= errorBudget) abortedReason = `错误数达熔断阈值 ${errorBudget}`;
    else abortedReason = "探测中止";
  }

  const byKind: Partial<Record<DecayKind, number>> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    checked: Math.min(next, n),
    healthy: aborted ? undefined : plugins.length - findings.length,
    byKind,
    aborted: aborted || undefined,
    abortedReason,
    findings: findings.sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}
