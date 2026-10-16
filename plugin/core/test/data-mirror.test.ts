/**
 * #249 · 数据源镜像与回退测试
 *
 * 场景：国内直连 GitHub Pages / dsh.market 不可达（301 → 明文 http → 超时），
 * core 取数候选必须带上 jsDelivr 镜像，且记忆地址失效后能重探其余候选。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchMarketData, fetchPacksData } from "../src/data.js";
import { resolveConfig } from "../src/config.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();

function makeCfg(cacheTtlMs?: number) {
  const dir = mkdtempSync(join(tmpdir(), "dshm-mirror-"));
  return resolveConfig({ dshHome: dir, dataDir: join(dir, "data"), dataSource: { cacheTtlMs } });
}

interface Route {
  match: string;
  ok: boolean;
  body?: unknown;
}

/** 按 URL 包含匹配路由的 fetch mock（未命中路由 = 网络失败）；记录全部尝试的 URL */
function urlRoutedFetch(routes: Route[]) {
  const attempted: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    attempted.push(url);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit || !hit.ok) throw new Error(`blocked: ${url}`);
    return { ok: true, status: 200, json: async () => hit.body ?? market } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, attempted };
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

afterEach(() => {
  delete process.env.DSH_MARKET_LITE_URL;
  delete process.env.DSH_MARKET_REMOTE_URL;
});

describe("#249 数据源镜像回退", () => {
  it("github.io 失败 → jsDelivr 镜像接管，并记住镜像（下次不再试 github.io）", async () => {
    const cfg = makeCfg();
    const { impl, attempted } = urlRoutedFetch([{ match: "jsdelivr", ok: true }]);

    const r1 = await withFetch(impl, () => fetchMarketData(cfg));
    expect(r1.source).toBe("remote");
    expect(attempted.some((u) => u.includes("cdn.jsdelivr.net"))).toBe(true);
    expect(attempted.some((u) => u.includes("github.io"))).toBe(true);

    // 记忆生效：第二次只走镜像，不再为 github.io 付超时代价
    attempted.length = 0;
    await withFetch(impl, () => fetchMarketData(cfg));
    expect(attempted.length).toBeGreaterThan(0);
    expect(attempted.every((u) => u.includes("jsdelivr"))).toBe(true);
  });

  it("记忆的镜像地址失效 → 清记忆全量重探，落到恢复的 Pages 源", async () => {
    const cfg = makeCfg();
    // 第一轮：jsDelivr 成功并被记住
    await withFetch(urlRoutedFetch([{ match: "jsdelivr", ok: true }]).impl, () =>
      fetchMarketData(cfg),
    );
    // 第二轮：jsDelivr 也挂了，github.io 恢复 → 清记忆后应落到 github.io
    const { impl, attempted } = urlRoutedFetch([{ match: "github.io", ok: true }]);
    const r = await withFetch(impl, () => fetchMarketData(cfg));
    expect(r.source).toBe("remote");
    expect(attempted.some((u) => u.includes("github.io"))).toBe(true);
  });

  it("DSH_MARKET_LITE_URL 环境变量可覆盖数据源，且自定义源不套镜像", async () => {
    process.env.DSH_MARKET_LITE_URL = "https://mirror.example.com/my-lite.json";
    const cfg = makeCfg();
    expect(cfg.liteUrl).toBe("https://mirror.example.com/my-lite.json");

    const { impl, attempted } = urlRoutedFetch([{ match: "example.com", ok: true }]);
    const r = await withFetch(impl, () => fetchMarketData(cfg));
    expect(r.source).toBe("remote");
    // 自定义 lite 源只有它自己一个候选（镜像只服务于默认 Pages 地址）
    expect(attempted.filter((u) => u.includes("example.com")).length).toBe(1);
  });

  it("packs：成功后写缓存，全部源失败时回退过期缓存而非空数组", async () => {
    const packs = [{ id: "demo", name: "Demo Pack" }];
    const cfg = makeCfg(-1); // TTL -1：缓存恒为过期 → 每次都走网络路径，可测 stale 兜底

    await withFetch(
      urlRoutedFetch([{ match: "packs.json", ok: true, body: { packs } }]).impl,
      () => fetchPacksData(cfg),
    );
    const r2 = await withFetch(
      urlRoutedFetch([{ match: "never-matches", ok: true }]).impl,
      () => fetchPacksData(cfg),
    );
    expect(r2).toEqual(packs);
  });
});
