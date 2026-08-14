/**
 * 市场数据获取：线上优先 → 本地文件兜底 → 磁盘缓存
 * 纯 Node 实现（global fetch，Node 18+）。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MarketData } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";

const CACHE_FILE = "plugins-cache.json";

export interface MarketDataResult {
  data: MarketData;
  /** 数据来源：remote / local / cache */
  source: "remote" | "local" | "cache";
  /** 是否使用了过期缓存（fetch 失败降级） */
  stale?: boolean;
  /** 数据 age ms */
  ageMs?: number;
}

/** 拉取市场数据（远程优先，失败逐级降级：本地文件 → 磁盘缓存） */
export async function fetchMarketData(
  cfg: ResolvedConfig,
): Promise<MarketDataResult> {
  // 1. 远程
  try {
    const res = await fetch(cfg.remoteUrl, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = (await res.json()) as MarketData;
      writeCache(cfg, data);
      return { data, source: "remote" };
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // 2. 本地文件兜底（开发模式）
    if (cfg.localDataPath && existsSync(cfg.localDataPath)) {
      try {
        const data = JSON.parse(
          readFileSync(cfg.localDataPath, "utf8"),
        ) as MarketData;
        return { data, source: "local" };
      } catch {
        /* fall through */
      }
    }
    // 3. 磁盘缓存（允许过期，标记 stale）
    const cached = readCache(cfg);
    if (cached) {
      return {
        data: cached,
        source: "cache",
        stale: true,
        ageMs: cacheAge(cfg),
      };
    }
    throw new Error(`无法获取市场数据：${(err as Error).message}`);
  }
}

/** 读取磁盘缓存（未过期且有效时返回） */
export function readCachedData(cfg: ResolvedConfig): MarketDataResult | null {
  const data = readCache(cfg);
  if (!data) return null;
  const ageMs = cacheAge(cfg);
  return {
    data,
    source: "cache",
    stale: ageMs > cfg.cacheTtlMs,
    ageMs,
  };
}

function cachePath(cfg: ResolvedConfig): string {
  return join(cfg.dataDir, CACHE_FILE);
}

function writeCache(cfg: ResolvedConfig, data: MarketData): void {
  try {
    if (!existsSync(cfg.dataDir)) mkdirSync(cfg.dataDir, { recursive: true });
    writeFileSync(cachePath(cfg), JSON.stringify(data), "utf8");
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

function readCache(cfg: ResolvedConfig): MarketData | null {
  try {
    const p = cachePath(cfg);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as MarketData;
  } catch {
    return null;
  }
}

function cacheAge(cfg: ResolvedConfig): number {
  try {
    const p = cachePath(cfg);
    if (!existsSync(p)) return Number.MAX_SAFE_INTEGER;
    return Date.now() - statSync(p).mtimeMs;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
