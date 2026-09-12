import { describe, expect, it, vi } from "vitest";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import { scanDecay } from "../src/decay.js";
import { batchProbeRepos, buildRepoBatchQuery, DEFAULT_BATCH_SIZE } from "../src/decay-probe.js";

/** 造一个 fetch Response 形状（只实现本模块用到的部分） */
function res(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** 按 alias 数量造一个全健康的 GraphQL 响应 */
function healthyResponse(names: string[]) {
  const data: Record<string, unknown> = {};
  names.forEach((f, i) => {
    data[`r${i}`] = {
      nameWithOwner: f,
      isArchived: false,
      isFork: false,
      pushedAt: new Date().toISOString(),
      stargazerCount: 5,
    };
  });
  return { data };
}

/** 从查询体里按 alias 顺序还原 owner/name（保证 mock 的响应键与请求位置严格对齐） */
function parseNames(query: string): string[] {
  return [...query.matchAll(/r\d+: repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)].map(
    (m) => `${m[1]}/${m[2]}`,
  );
}

/** 通用 mock：解析请求里的仓库名，返回全健康响应（可注入失败条件） */
function makeGqlMock(shouldFail?: (query: string) => boolean) {
  return async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(init.body as string) as { query: string };
    if (shouldFail?.(query)) throw new Error("fetch failed");
    return res(healthyResponse(parseNames(query)));
  };
}

describe("buildRepoBatchQuery", () => {
  it("每个仓库一个 alias，owner/name 拆正确", () => {
    const q = buildRepoBatchQuery(["a/b", "o/n"]);
    expect(q).toContain('r0: repository(owner: "a", name: "b")');
    expect(q).toContain('r1: repository(owner: "o", name: "n")');
    expect(q).toContain("isArchived");
    expect(q).toContain("isFork");
  });
});

describe("batchProbeRepos · GraphQL 批量探测", () => {
  it("556 个仓库 → 按 batchSize 分批（100/批 → 6 次请求），比逐仓库省 99%", async () => {
    const names = Array.from({ length: 556 }, (_, i) => `o${i}/p${i}`);
    const fetchImpl = vi.fn(makeGqlMock());
    const r = await batchProbeRepos(names, {
      batchSize: DEFAULT_BATCH_SIZE,
      delayMs: 0,
      fetchImpl: fetchImpl as never,
      token: "t",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6); // ceil(556/100)
    expect(r.stats.requests).toBe(6);
    expect(r.stats.total).toBe(556); // 请求数远小于仓库数
    expect(r.stats.unprobed).toBe(0);
    expect(r.unprobed).toHaveLength(0);
  });

  it("NOT_FOUND 的 alias → map 里记 null（= gone），其余正常", async () => {
    const names = ["ok/a", "ghost/b", "ok/c"];
    const fetchImpl = async () =>
      res({
        data: {
          r0: { nameWithOwner: "ok/a", isArchived: false, isFork: false, pushedAt: "2026-09-01T00:00:00Z", stargazerCount: 1 },
          r1: null,
          r2: { nameWithOwner: "ok/c", isArchived: true, isFork: false, pushedAt: "2026-09-01T00:00:00Z", stargazerCount: 1 },
        },
        errors: [
          {
            type: "NOT_FOUND",
            message: "Could not resolve to a Repository",
            path: ["r1"],
          },
        ],
      });
    const r = await batchProbeRepos(names, { fetchImpl: fetchImpl as never, token: "t", delayMs: 0 });
    expect(r.map.get("ghost/b")).toBeNull();
    expect(r.map.get("ok/a")?.archived).toBe(false);
    expect(r.map.get("ok/c")?.archived).toBe(true);
    expect(r.stats.notFound).toBe(1);
    expect(r.stats.unprobed).toBe(0);
  });

  it("403 限流 + 预算不足 → 立即停止（不做 60s×3 的傻等）且未覆盖数保留", async () => {
    const names = Array.from({ length: 350 }, (_, i) => `o${i}/p${i}`);
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return res({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" });
    };
    const t0 = Date.now();
    const r = await batchProbeRepos(names, {
      batchSize: 100,
      concurrency: 3,
      delayMs: 0,
      budgetMs: 300, // 预算小于一次限流等待（5s）→ 直接放弃，不睡
      fetchImpl: fetchImpl as never,
      token: "t",
    });
    const el = Date.now() - t0;
    expect(calls).toBeLessThanOrEqual(3); // 并发 3 个在途，停止后不再发新批
    expect(el).toBeLessThan(2000); // 关键回归：绝不再 sleep 60s×3 次
    expect(r.stats.rateLimited).toBe(true);
    expect(r.stats.unprobed).toBe(350); // 全部未覆盖 → 上层标 error，不假装健康
    expect(r.unprobed).toHaveLength(350);
  });

  it("GraphQL 报 RATE_LIMITED → 同样停止", async () => {
    const fetchImpl = async () =>
      res({ data: null, errors: [{ type: "RATE_LIMITED", message: "rate limited" }] });
    const r = await batchProbeRepos(["a/b", "c/d"], {
      batchSize: 1,
      concurrency: 1,
      delayMs: 0,
      budgetMs: 300,
      fetchImpl: fetchImpl as never,
      token: "t",
    });
    expect(r.stats.rateLimited).toBe(true);
    expect(r.stats.unprobed).toBe(2);
  });

  it("网络抖动（fetch failed）→ 有界重试；仍失败则只放弃该批，**不放弃整轮**", async () => {
    // 含 owner "fail" 的批永远网络失败，其余批次正常 → 后续批次必须照常被探测
    // （旧实现"任一异常即 stop"会在这里把整轮扫描废掉：本地实测 6358 条全判未覆盖）
    const fetchImpl = makeGqlMock((query) => query.includes('owner: "fail"'));
    const r = await batchProbeRepos(["fail/a", "fail/b", "ok/c"], {
      batchSize: 2,
      concurrency: 1,
      delayMs: 0,
      retryBaseMs: 5, // 测试里退避要短，否则 3 次重试会超过 vitest 默认 5s 超时
      budgetMs: 30_000,
      fetchImpl: fetchImpl as never,
      token: "t",
    });
    expect(r.stats.retries).toBeGreaterThan(0); // 确实重试过
    expect(r.stats.rateLimited).toBe(false); // 网络抖动不算限流
    expect(r.unprobed).toContain("fail/a"); // 坏批的仓库仍标记未覆盖
    expect(r.map.has("ok/c")).toBe(true); // 但后续批次照常探测 —— 不因一次抖动全盘放弃
  });

  it("缺 token → 不发请求，全部未覆盖（绝不假装健康）", async () => {
    const fetchImpl = vi.fn();
    const r = await batchProbeRepos(["a/b"], { token: "", fetchImpl: fetchImpl as never });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.unprobed).toEqual(["a/b"]);
  });

  it("预算耗尽 → budgetExceeded 且停止发新批", async () => {
    const names = Array.from({ length: 300 }, (_, i) => `o${i}/p${i}`);
    const inner = makeGqlMock();
    const fetchImpl = async (u: string, init: RequestInit) => {
      await new Promise((r) => setTimeout(r, 30));
      return inner(u, init);
    };
    const r = await batchProbeRepos(names, {
      batchSize: 50,
      concurrency: 1,
      delayMs: 0,
      budgetMs: 40,
      fetchImpl: fetchImpl as never,
      token: "t",
    });
    expect(r.stats.budgetExceeded).toBe(true);
    expect(r.stats.requests).toBeLessThan(6);
    expect(r.stats.unprobed).toBeGreaterThan(0);
  });
});

describe("scanDecay × 批量探测（端到端语义）", () => {
  function plugin(id: string, partial: Partial<DshPlugin> = {}): DshPlugin {
    return {
      id,
      type: "cordis-plugin",
      name: id.split("/")[1] ?? id,
      owner: id.split("/")[0] ?? "o",
      repo: id.split("/")[1] ?? id,
      fullName: id,
      stars: 10,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      description: "d",
      descriptionZh: null,
      tags: [],
      curated: false,
      homepage: null,
      license: "MIT",
      topics: [],
      pushedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      readmeSummary: null,
      install: { method: "pnpm-profile", needsConfig: false },
      score: { total: 50, breakdown: { maintain: 50, practical: 50, popularity: 50, ease: 50, signal: 50 }, confidence: 0.5, explanation: "" },
      sources: ["topic"],
      lastCheckedAt: new Date().toISOString(),
      ...partial,
    };
  }
  const market = (plugins: DshPlugin[]): MarketData => ({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    plugins,
  });

  it("未覆盖（限流中止）的仓库标 error 而非静默 healthy；已确认消失的标 gone", async () => {
    const names = ["ok/a", "ghost/b", "skip/c"];
    const fetchImpl = async () =>
      res({
        data: { r0: { nameWithOwner: "ok/a", isArchived: false, isFork: false, pushedAt: new Date().toISOString(), stargazerCount: 1 } },
        errors: [{ type: "NOT_FOUND", message: "nope", path: ["r1"] }],
      }); // r2 缺项 → 未覆盖
    const probe = await batchProbeRepos(names, { batchSize: 100, fetchImpl: fetchImpl as never, token: "t" });
    expect(probe.map.has("skip/c")).toBe(false);

    const probeRepo = async (fullName: string) => {
      if (!probe.map.has(fullName)) throw new Error("本轮未覆盖（限流/预算/批失败），需下轮复查");
      return probe.map.get(fullName) ?? null;
    };
    const r = await scanDecay(market(names.map((n) => plugin(n))), {
      fetchRepo: probeRepo,
      abortOnErrors: false, // 批量路径必须关掉熔断，否则未覆盖的条目会被截断
    });
    const kinds = Object.fromEntries(r.findings.map((f) => [f.fullName, f.kind]));
    expect(kinds["ghost/b"]).toBe("gone");
    expect(kinds["skip/c"]).toBe("error");
    expect(kinds["ok/a"]).toBeUndefined();
    expect(r.checked).toBe(3); // 全部有结论（健康/失效/未核实），覆盖度透明
  });
});
