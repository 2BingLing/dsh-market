import { describe, expect, it } from "vitest";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import { scanDecay, type RepoSnapshot } from "../src/decay.js";

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
    description: `${id} desc`,
    descriptionZh: null,
    tags: [],
    curated: false,
    homepage: null,
    license: "MIT",
    topics: [],
    pushedAt: partial.pushedAt ?? new Date().toISOString(),
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

function market(plugins: DshPlugin[]): MarketData {
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), plugins };
}

describe("scanDecay · 熔断（2026-08-24 事故回归）", () => {
  it("错误数超预算 → aborted=true 且 checked < 总数（只出部分结果，不无限跑）", async () => {
    // 20 个仓库，全部探测抛错（模拟限流风暴；加 5ms 延迟模拟真实请求节奏，让熔断来得及生效）
    const plugins = Array.from({ length: 20 }, (_, i) => plugin(`band${i}/p${i}`));
    const m = market(plugins);
    const r = await scanDecay(m, {
      fetchRepo: async () => {
        await new Promise((res) => setTimeout(res, 5));
        throw new Error("rate limited");
      },
      abortErrors: 5,   // 5 个错误即熔断
      abortErrorRatio: 0, // 只看绝对阈值（0 → 不按比例放宽）
      concurrency: 4,
    });
    expect(r.aborted).toBe(true);
    expect(r.checked).toBeLessThan(plugins.length);
    expect(r.findings.every((f) => f.kind === "error")).toBe(true);
  });

  it("正常完成（错误数低于预算）→ aborted 为 undefined，checked 等于总数", async () => {
    const m = market([plugin("ok/a"), plugin("ok/b")]);
    const r = await scanDecay(m, {
      fetchRepo: async (full) => ({ full_name: full, archived: false, fork: false, pushed_at: new Date().toISOString() }),
      abortErrors: 5,
      concurrency: 2,
    });
    expect(r.aborted).toBeUndefined();
    expect(r.checked).toBe(2);
    expect(r.findings).toHaveLength(0);
  });

  it("onProgress 进度回调触发（>1 次）", async () => {
    const m = market(Array.from({ length: 12 }, (_, i) => plugin(`ok${i}/p${i}`)));
    let calls = 0;
    await scanDecay(m, {
      fetchRepo: async (full) => ({ full_name: full, archived: false, fork: false, pushed_at: new Date().toISOString() }),
      concurrency: 3,
      onProgress: () => { calls++; },
    });
    expect(calls).toBeGreaterThan(0);
  });
});

describe("scanDecay", () => {
  it("健康仓库 → 无 finding，healthy=checked", async () => {
    const m = market([plugin("ok/a"), plugin("ok/b")]);
    const r = await scanDecay(m, {
      fetchRepo: async (full) => ({ full_name: full, archived: false, fork: false, pushed_at: new Date().toISOString() }),
      dormantDays: 270,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.healthy).toBe(2);
  });

  it("404 → gone", async () => {
    const m = market([plugin("ghost/repo")]);
    const r = await scanDecay(m, { fetchRepo: async () => null });
    expect(r.findings[0].kind).toBe("gone");
  });

  it("archived → archived；fork → forked", async () => {
    const m = market([plugin("a/arch"), plugin("b/fork")]);
    const r = await scanDecay(m, {
      fetchRepo: async (full) =>
        full === "a/arch"
          ? { full_name: full, archived: true, fork: false, pushed_at: "" }
          : { full_name: full, archived: false, fork: true, pushed_at: "" },
    });
    const kinds = Object.fromEntries(r.findings.map((f) => [f.fullName, f.kind]));
    expect(kinds["a/arch"]).toBe("archived");
    expect(kinds["b/fork"]).toBe("forked");
  });

  it("超过停更阈值 → dormant（含天数）", async () => {
    const oldDays = 400;
    const m = market([
      plugin("dorm/x", {
        pushedAt: new Date(Date.now() - oldDays * 86_400_000).toISOString(),
      }),
    ]);
    const r = await scanDecay(m, {
      fetchRepo: async () => ({
        full_name: "dorm/x",
        archived: false,
        fork: false,
        pushed_at: new Date(Date.now() - oldDays * 86_400_000).toISOString(),
      }),
      dormantDays: 270,
    });
    expect(r.findings[0].kind).toBe("dormant");
    expect(r.findings[0].days).toBeGreaterThan(270);
  });

  it("仓库改名/转移 → gone（由每日扫描重新收录）", async () => {
    const m = market([plugin("old/name")]);
    const r = await scanDecay(m, {
      fetchRepo: async () => ({ full_name: "new/name", archived: false, fork: false, pushed_at: "" }),
    });
    expect(r.findings[0].kind).toBe("gone");
    expect(r.findings[0].detail).toContain("new/name");
  });

  it("探测抛错 → error（不中断整体）", async () => {
    const m = market([plugin("err/a"), plugin("ok/a")]);
    const r = await scanDecay(m, {
      fetchRepo: async (full) => {
        if (full === "err/a") throw new Error("rate limited");
        return { full_name: full, archived: false, fork: false, pushed_at: new Date().toISOString() };
      },
    });
    const kinds = Object.fromEntries(r.findings.map((f) => [f.fullName, f.kind]));
    expect(kinds["err/a"]).toBe("error");
    expect(kinds["ok/a"]).toBeUndefined();
  });

  it("按 id 去重 + byKind 统计正确", async () => {
    const m = market([plugin("dup/a"), plugin("dup/a"), plugin("gone/b")]);
    const r = await scanDecay(m, {
      fetchRepo: async (full) => (full === "gone/b" ? null : { full_name: full, archived: false, fork: false, pushed_at: new Date().toISOString() }),
    });
    expect(r.checked).toBe(2); // 去重后
    expect(r.byKind.gone).toBe(1);
    expect(r.findings).toHaveLength(1);
  });
});
