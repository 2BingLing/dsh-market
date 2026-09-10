/**
 * 缓存优先取数（loadMarketData）测试
 *
 * 修的是「磁盘缓存写了却从不读」：旧实现远程优先，缓存只在远程失败时兜底，
 * 于是每个 DSH 进程首次打开面板都要重下整份索引（实测 6–8s）。
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMarketData } from "../src/data.js";
import { resolveConfig } from "../src/config.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();

function makeCfg(opts: { ttlMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dshm-lmd-"));
  return resolveConfig({
    dshHome: dir,
    dataDir: join(dir, "data"),
    dataSource: { remoteUrl: "https://example.test/plugins-lite.json", cacheTtlMs: opts.ttlMs },
  });
}

/** 预置一份磁盘缓存；ageMs 控制它的"年纪"（相对 TTL 判断新鲜/过期） */
function seedCache(cfg: ReturnType<typeof makeCfg>, ageMs: number) {
  mkdirSync(cfg.dataDir, { recursive: true });
  const p = join(cfg.dataDir, "plugins-cache.json");
  writeFileSync(p, JSON.stringify(market), "utf8");
  const t = new Date(Date.now() - ageMs);
  utimesSync(p, t, t);
}

function withFetch(impl: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("loadMarketData · 缓存优先", () => {
  it("未过期缓存 → 直接返回，且完全不发起网络请求", async () => {
    const cfg = makeCfg({ ttlMs: 60 * 60 * 1000 });
    seedCache(cfg, 5 * 60 * 1000); // 5 分钟前，TTL 内
    const spy = vi.fn(async () => {
      throw new Error("不应该发起网络请求");
    }) as unknown as typeof fetch;
    const restore = withFetch(spy);
    try {
      const r = await loadMarketData(cfg);
      expect(r.source).toBe("cache");
      expect(r.stale).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("过期缓存 → 先返回旧数据（stale），并触发后台刷新回调", async () => {
    const cfg = makeCfg({ ttlMs: 1000 });
    seedCache(cfg, 60 * 60 * 1000); // 1 小时前，已过期
    const fresh = { ...market, generatedAt: "2099-01-01T00:00:00.000Z" };
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fresh,
    })) as unknown as typeof fetch;
    const restore = withFetch(spy);
    try {
      let revalidated: unknown = null;
      const r = await loadMarketData(cfg, { revalidate: (f) => { revalidated = f; } });

      // 前台拿到的是旧数据，用户不等待
      expect(r.source).toBe("cache");
      expect(r.stale).toBe(true);
      expect(r.data.generatedAt).not.toBe("2099-01-01T00:00:00.000Z");

      // 后台刷新是 fire-and-forget，等它落地
      await vi.waitFor(() => expect(revalidated).not.toBeNull());
      expect(spy).toHaveBeenCalled();
      expect((revalidated as { data: { generatedAt: string } }).data.generatedAt).toBe(
        "2099-01-01T00:00:00.000Z",
      );
    } finally {
      restore();
    }
  });

  it("无缓存 → 前台拉取（首次安装/清缓存后的唯一等待路径）", async () => {
    const cfg = makeCfg();
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => market,
    })) as unknown as typeof fetch;
    const restore = withFetch(spy);
    try {
      const r = await loadMarketData(cfg);
      expect(r.source).toBe("remote");
      expect(spy).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("瘦身索引可用时优先命中它，不请求全量", async () => {
    const cfg = resolveConfig({
      dshHome: mkdtempSync(join(tmpdir(), "dshm-lmd-")),
      dataSource: {
        remoteUrl: "https://example.test/plugins.json",
        liteUrl: "https://example.test/plugins-lite.json",
      },
    });
    const urls: string[] = [];
    const spy = vi.fn(async (u: string) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => market };
    }) as unknown as typeof fetch;
    const restore = withFetch(spy);
    try {
      await loadMarketData(cfg);
      expect(urls).toEqual(["https://example.test/plugins-lite.json"]);
    } finally {
      restore();
    }
  });

  it("瘦身索引 404 → 自动回退全量索引", async () => {
    const cfg = resolveConfig({
      dshHome: mkdtempSync(join(tmpdir(), "dshm-lmd-")),
      dataSource: {
        remoteUrl: "https://example.test/plugins.json",
        liteUrl: "https://example.test/plugins-lite.json",
      },
    });
    const urls: string[] = [];
    const spy = vi.fn(async (u: string) => {
      urls.push(String(u));
      const notFound = String(u).includes("lite");
      return { ok: !notFound, status: notFound ? 404 : 200, json: async () => market };
    }) as unknown as typeof fetch;
    const restore = withFetch(spy);
    try {
      const r = await loadMarketData(cfg);
      expect(r.source).toBe("remote");
      expect(urls).toEqual([
        "https://example.test/plugins-lite.json",
        "https://example.test/plugins.json",
      ]);
    } finally {
      restore();
    }
  });
});
