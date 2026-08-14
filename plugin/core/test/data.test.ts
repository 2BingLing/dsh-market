import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchMarketData, readCachedData } from "../src/data.js";
import { resolveConfig } from "../src/config.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-data-"));
  return resolveConfig({ dshHome: dir, dataDir: join(dir, "data") });
}

describe("fetchMarketData", () => {
  it("远程成功 → source remote，并写入缓存", async () => {
    const cfg = makeCfg();
    const ok = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => market,
    })) as unknown as typeof fetch;
    const r = await fetchMarketDataWith(cfg, ok);
    expect(r.source).toBe("remote");
    // 缓存已写入
    const cached = readCachedData(cfg);
    expect(cached).not.toBeNull();
    expect(cached!.data.plugins.length).toBe(market.plugins.length);
  });

  it("远程失败 + 本地文件 → 本地兜底", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-data-"));
    const localPath = join(dir, "plugins.json");
    writeFileSync(localPath, JSON.stringify(market));
    const cfg = resolveConfig({
      dshHome: dir,
      dataDir: join(dir, "data"),
      dataSource: { localPath },
    });
    const fail = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await fetchMarketDataWith(cfg, fail);
    expect(r.source).toBe("local");
  });

  it("远程失败 + 无本地无缓存 → 抛错", async () => {
    const cfg = makeCfg();
    const fail = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchMarketDataWith(cfg, fail)).rejects.toThrow();
  });
});

// 注入 fetch 实现（核心层 data.ts 使用 global fetch，测试时替换）
async function fetchMarketDataWith(
  cfg: ReturnType<typeof makeCfg>,
  impl: typeof fetch,
) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fetchMarketData(cfg);
  } finally {
    globalThis.fetch = orig;
  }
}
