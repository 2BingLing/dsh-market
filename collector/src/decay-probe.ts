/**
 * 失效扫描的批量探测层（2026-09-12 事故修复）
 *
 * 背景（事故）：原实现走 REST `/repos/{fullName}` 逐仓库探测，5572 个仓库 = 5572 次请求。
 *   - `data/cache` 未入库（.gitignore），CI 每次都是全新 checkout → decay.ts 里的
 *     「7 天检测缓存短路」在 CI **永远不命中**（本地看着很省、线上零效果）；
 *   - `github.token` 配额在约第 4800 个请求见底 → githubFetch 对 403 会 sleep≤60s 再重试（3 次），
 *     于是剩下 570+ 个请求每个要耗 ~180s，5 并发也要跑 5 小时；
 *   - 熔断阈值 max(150, 15%) 约 836 个错误，按 1.7 错误/分钟永远够不到；
 *   - 最终撞 `timeout-minutes: 40` 被 cancel，第 6 步（汇总 issue）被 skip → 每周一静默失败。
 *
 * 修复：GraphQL 一次请求探测 **100 个仓库**（实测 body ~12KB、200 OK、点数消耗 0，
 *   相当于 1 rate-limit point/请求）。5572 个仓库 → 约 56 次请求，比 REST 少 ~99%，
 *   顺带不再与每日 collect 抢配额。
 *
 * 容错策略（2026-09-12 二次修订，本地实测踩到）：
 *   - **配额耗尽** → 停止本轮（不 sleep 死等）；未覆盖的仓库交上层标 `error`，绝不假装健康；
 *   - **网络抖动 / 5xx** → 有界重试（不放弃整轮！）——本地实测一次 `fetch failed`
 *     就会让"整批 stop"把 6358 条全判成未覆盖，属于过度反应；
 *   - **二级限流**（GraphQL 点数还有、但请求过密被拒）→ 按 Retry-After 短睡后**重试同一批**，
 *     总等待受墙钟预算约束；
 *   - 预算 deadline：无论如何超时即停，保证 job 一定能在 timeout 之前产出报告。
 */
import type { RepoSnapshot } from "./decay.js";

/** GraphQL 单批上限（实测 100 个仓库的查询 body ~12KB，稳妥） */
export const DEFAULT_BATCH_SIZE = 100;
/** 批次并发（GitHub 对 GraphQL 有二级限流，保守取 2） */
export const DEFAULT_CONCURRENCY = 2;
/** 批间间隔（ms），降低二级限流概率 */
export const DEFAULT_DELAY_MS = 150;
/** 重试退避基数（ms） */
export const DEFAULT_RETRY_BASE_MS = 1000;
/** 默认总预算 12 分钟（job timeout 之后还有余量产出报告） */
export const DEFAULT_BUDGET_MS = 12 * 60_000;

export interface BatchProbeStats {
  /** 输入去重后的仓库数 */
  total: number;
  /** 实际发起的 GraphQL 请求数（含重试） */
  requests: number;
  /** 成功解析出的仓库数（含判定 gone 的） */
  resolved: number;
  /** 判定为不存在（GraphQL NOT_FOUND）的数量 */
  notFound: number;
  /** 未覆盖（批失败 / 预算耗尽 / 限流中止）的仓库数 */
  unprobed: number;
  failedBatches: number;
  /** 网络抖动/5xx 造成的重试次数 */
  retries: number;
  /** 是否因限流提前中止（剩余仓库未覆盖） */
  rateLimited: boolean;
  /** 是否因预算耗尽提前中止 */
  budgetExceeded: boolean;
  elapsedMs: number;
  /** 最后一次响应里的 x-ratelimit-remaining（便于排障） */
  rateLimitRemaining: string | null;
}

export interface BatchProbeResult {
  /** fullName → 快照；null = 仓库不存在（gone）。未覆盖的仓库**不在 map 里** */
  map: Map<string, RepoSnapshot | null>;
  /** 未覆盖的仓库（需下轮复查） */
  unprobed: string[];
  stats: BatchProbeStats;
}

export interface BatchProbeOpts {
  batchSize?: number;
  concurrency?: number;
  delayMs?: number;
  budgetMs?: number;
  token?: string;
  /** 重试退避基数（ms），测试里调小以免拖慢用例；默认 1000 */
  retryBaseMs?: number;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number, stats: BatchProbeStats) => void;
}

interface GqlRepoNode {
  nameWithOwner?: string;
  isArchived?: boolean;
  isFork?: boolean;
  pushedAt?: string;
  stargazerCount?: number;
}

interface GraphQLResponse {
  data?: Record<string, GqlRepoNode | null> | null;
  errors?: Array<{ type?: string; message?: string; path?: Array<string | number> }>;
}

/**
 * GraphQL 字段名 → RepoSnapshot（REST 风格）归一化。
 * 必须做：scanDecay 判定用的是 full_name/archived/fork/pushed_at，
 * 少一层映射会让归档/fork/改名检测**静默失效**（回归测试 test/decay-probe.test.ts 覆盖）。
 */
export function toRepoSnapshot(node: GqlRepoNode): RepoSnapshot {
  return {
    full_name: node.nameWithOwner,
    archived: node.isArchived,
    fork: node.isFork,
    pushed_at: node.pushedAt,
    stargazers_count: node.stargazerCount,
  };
}

/** 拼一批仓库的 GraphQL 查询（每个仓库一个 alias） */
export function buildRepoBatchQuery(fullNames: string[]): string {
  const parts = fullNames.map((f, i) => {
    const slash = f.indexOf("/");
    const owner = slash === -1 ? f : f.slice(0, slash);
    const name = slash === -1 ? "" : f.slice(slash + 1);
    // owner/name 来自已收录的 GitHub fullName（[A-Za-z0-9_.-]），不含引号，直接内联安全
    return `r${i}: repository(owner: "${owner}", name: "${name}") { nameWithOwner isArchived isFork pushedAt stargazerCount }`;
  });
  return `{ ${parts.join(" ")} }`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 整个响应级别的限流/权限错误（整批不可用） */
function isFatalGraphQLError(errors: GraphQLResponse["errors"]): boolean {
  if (!errors?.length) return false;
  const fatalTypes = new Set(["RATE_LIMITED", "FORBIDDEN", "UNAUTHORIZED"]);
  return errors.some((e) => (e.type ? fatalTypes.has(e.type) : false));
}

/** 单批的处理结果 */
type BatchOutcome = "ok" | "rate-limited" | "give-up";

/**
 * 批量探测仓库是否存在/归档/成 fork（GraphQL，100 个/请求）。
 *
 * 返回的 map 只包含**已探测**的仓库；未覆盖的（批失败、限流中止、预算耗尽）列在 `unprobed` 里，
 * 由调用方决定如何标记（本仓库约定：标 `error`，需下轮复查）。
 */
export async function batchProbeRepos(
  fullNames: string[],
  opts: BatchProbeOpts = {},
): Promise<BatchProbeResult> {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_DELAY_MS);
  const retryBaseMs = Math.max(1, opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const budgetMs = Math.max(0, opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? "";
  const deadline = Date.now() + budgetMs;
  const /** 网络抖动重试上限（不含限流等待） */ MAX_TRANSIENT_RETRY = 3;
  const /** 单次限流最长等待（受预算二次约束） */ MAX_RATE_WAIT_MS = 30_000;

  // 去重（同一仓库可能因多路径重复收录）
  const uniq = [...new Set(fullNames)];
  const batches = chunk(uniq, batchSize);

  const map = new Map<string, RepoSnapshot | null>();
  const unprobed = new Set<string>(uniq);
  const stats: BatchProbeStats = {
    total: uniq.length,
    requests: 0,
    resolved: 0,
    notFound: 0,
    unprobed: uniq.length,
    failedBatches: 0,
    retries: 0,
    rateLimited: false,
    budgetExceeded: false,
    elapsedMs: 0,
    rateLimitRemaining: null,
  };

  const t0 = Date.now();
  let next = 0;
  /** 只有"令牌缺失/预算耗尽/限流后确实等不起"才整轮停止；网络抖动绝不停止 */
  let stop = false;
  if (!token) {
    console.error("  ⚠️ 缺少 GITHUB_TOKEN，批量探测无法进行 → 全部标 error 待下轮复查");
    stop = true;
  }

  const runBatch = async (names: string[]): Promise<BatchOutcome> => {
    let transient = 0;
    for (;;) {
      if (Date.now() > deadline) {
        stats.budgetExceeded = true;
        stop = true;
        return "give-up";
      }
      stats.requests++;
      try {
        const res = await doFetch("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "dsh-market-bot",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query: buildRepoBatchQuery(names) }),
          signal: AbortSignal.timeout(45_000),
        });
        stats.rateLimitRemaining = res.headers.get("x-ratelimit-remaining");

        if (res.status === 403 || res.status === 429) {
          // 二级限流：点数可能还有，但请求过密。短睡后**重试同一批**（不再像旧实现那样傻等 60s×3）
          const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
          const wait = Math.min(retryAfter || retryBaseMs * 5 * Math.pow(2, transient), MAX_RATE_WAIT_MS);
          if (Date.now() + wait > deadline) {
            console.error(`  ⚠️ 触发限流且预算不足以等待（剩余配额 ${stats.rateLimitRemaining ?? "?"}）→ 停止本轮`);
            stats.rateLimited = true;
            stats.failedBatches++;
            stop = true;
            return "give-up";
          }
          let detail = "";
          try {
            detail = (await res.text()).slice(0, 160).replace(/\s+/g, " ");
          } catch {
            /* ignore */
          }
          console.error(`  ⚠️ 二级限流 HTTP ${res.status}（配额 ${stats.rateLimitRemaining ?? "?"}），${Math.round(wait / 1000)}s 后重试: ${detail}`);
          stats.retries++;
          await sleep(wait);
          continue;
        }

        if (!res.ok) {
          // 5xx：可重试；其他 4xx：本批放弃（不停止整轮）
          if (res.status >= 500 && transient < MAX_TRANSIENT_RETRY) {
            transient++;
            stats.retries++;
            await sleep(retryBaseMs * Math.pow(2, transient));
            continue;
          }
          console.error(`  ⚠️ 批次失败 HTTP ${res.status} → 本批 ${names.length} 个标记未覆盖`);
          stats.failedBatches++;
          return "give-up";
        }

        const json = (await res.json()) as GraphQLResponse;
        const data = json.data ?? {};

        if (isFatalGraphQLError(json.errors)) {
          const wait = Math.min(retryBaseMs * 5 * Math.pow(2, transient), MAX_RATE_WAIT_MS);
          if (Date.now() + wait > deadline) {
            console.error(`  ⚠️ GraphQL 限流且预算不足以等待: ${JSON.stringify(json.errors)?.slice(0, 160)}`);
            stats.rateLimited = true;
            stats.failedBatches++;
            stop = true;
            return "give-up";
          }
          console.error(`  ⚠️ GraphQL 限流，${Math.round(wait / 1000)}s 后重试: ${JSON.stringify(json.errors)?.slice(0, 160)}`);
          stats.retries++;
          await sleep(wait);
          continue;
        }

        // NOT_FOUND 的字段：path ["rN"] → 对应仓库不存在
        const notFoundIdx = new Set<number>();
        for (const e of json.errors ?? []) {
          if (e.type !== "NOT_FOUND") continue;
          const p = e.path?.[0];
          if (typeof p === "string" && p.startsWith("r")) notFoundIdx.add(Number(p.slice(1)));
        }

        let resolvedThisBatch = 0;
        names.forEach((full, i) => {
          const snap = data[`r${i}`];
          if (snap === undefined || snap === null) {
            // 有 NOT_FOUND 明确指向 → 确认消失；否则视为未知（保守起见不误报）
            if (notFoundIdx.has(i)) {
              map.set(full, null);
              stats.notFound++;
              unprobed.delete(full);
              resolvedThisBatch++;
            }
            return;
          }
          map.set(full, toRepoSnapshot(snap));
          unprobed.delete(full);
          resolvedThisBatch++;
        });
        stats.resolved += resolvedThisBatch;
        stats.unprobed = unprobed.size;
        if (resolvedThisBatch < names.length) stats.failedBatches++; // 少数缺项：如实计入失败批，但不致命
        return "ok";
      } catch (err) {
        // fetch failed / 超时（本地实测会遇到）：有界重试，**不放弃整轮**
        if (transient < MAX_TRANSIENT_RETRY) {
          transient++;
          stats.retries++;
          const wait = retryBaseMs * Math.pow(2, transient);
          if (Date.now() + wait > deadline) {
            stats.budgetExceeded = true;
            stop = true;
            return "give-up";
          }
          console.error(`  ⚠️ 批次网络异常（第 ${transient} 次重试）: ${(err as Error).message.slice(0, 100)}`);
          await sleep(wait);
          continue;
        }
        console.error(`  ⚠️ 批次连续异常，放弃该批（${names.length} 个标记未覆盖）: ${(err as Error).message.slice(0, 100)}`);
        stats.failedBatches++;
        return "give-up";
      }
    }
  };

  const runners = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (!stop) {
      const i = next++;
      if (i >= batches.length) break;
      if (Date.now() > deadline) {
        stats.budgetExceeded = true;
        stop = true;
        break;
      }
      await runBatch(batches[i]);
      stats.unprobed = unprobed.size;
      opts.onProgress?.(stats.total - unprobed.size, stats.total, stats);
      if (delayMs > 0 && !stop) await sleep(delayMs);
    }
  });
  await Promise.all(runners);

  stats.unprobed = unprobed.size;
  stats.elapsedMs = Date.now() - t0;
  return { map, unprobed: [...unprobed], stats };
}
