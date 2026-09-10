/**
 * 市场数据获取：线上优先 → 本地文件兜底 → 磁盘缓存
 * 纯 Node 实现（global fetch，Node 18+）。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPack, MarketData } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";

const CACHE_FILE = "plugins-cache.json";

/**
 * 每个配置记住「哪个远程地址真的能用」，避免每次取数都先撞一次 404 的瘦身索引。
 * 用 WeakMap 按 cfg 实例隔离：不同数据源互不影响，测试各自新建 cfg 也天然无串扰。
 */
const resolvedRemoteUrls = new WeakMap<ResolvedConfig, string>();

export interface MarketDataResult {
  data: MarketData;
  /** 数据来源：remote / local / cache */
  source: "remote" | "local" | "cache";
  /** 是否使用了过期缓存（fetch 失败降级 / 后台刷新中） */
  stale?: boolean;
  /** 数据 age ms */
  ageMs?: number;
}

/** 远程候选地址：瘦身索引优先，全量兜底（同一地址只列一次） */
function remoteCandidates(cfg: ResolvedConfig): string[] {
  const remembered = resolvedRemoteUrls.get(cfg);
  if (remembered !== undefined) return [remembered];
  const { liteUrl, remoteUrl } = cfg;
  return liteUrl && liteUrl !== remoteUrl ? [liteUrl, remoteUrl] : [remoteUrl];
}

/**
 * 按候选顺序拉远程，返回首个成功的结果。
 * 记住命中的地址，后续调用不再重复试探（否则每次都要等 404 往返）。
 */
async function fetchRemote(
  cfg: ResolvedConfig,
): Promise<{ data: MarketData; url: string } | null> {
  for (const url of remoteCandidates(cfg)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const data = (await res.json()) as MarketData;
      resolvedRemoteUrls.set(cfg, url);
      return { data, url };
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}

/** 拉取市场数据（远程优先，失败逐级降级：本地文件 → 磁盘缓存） */
export async function fetchMarketData(
  cfg: ResolvedConfig,
): Promise<MarketDataResult> {
  // 1. 远程（瘦身索引优先 → 全量兜底）
  const remote = await fetchRemote(cfg);
  if (remote !== null) {
    writeCache(cfg, remote.data);
    return { data: remote.data, source: "remote" };
  }

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
  throw new Error("无法获取市场数据：远程不可用且无本地缓存");
}

/**
 * 缓存优先取数（stale-while-revalidate）——面板打开走这条路径。
 *
 * 修的是「磁盘缓存写了却从不读」：`fetchMarketData` 是远程优先，缓存只在远程
 * 失败时兜底，于是每个 DSH 进程首次打开面板都要重下整份索引（实测 6–8s）。
 * 本函数改为：
 *
 *   未过期缓存 → 直接返回，**不发起网络**（数据每日更新一次，1h TTL 足够新鲜）
 *   过期缓存   → 立即返回旧数据，同时**后台刷新**（下次打开即最新，用户永不等待）
 *   无缓存     → 前台拉取（仅首次安装/清缓存后发生）
 *
 * @param cfg - 解析后的配置
 * @param opts.revalidate - 后台刷新完成后回调（用于更新调用方的内存快照）
 * @returns 取数结果，`source` 为 cache/remote/local，`stale` 表示后台正在刷新
 */
export async function loadMarketData(
  cfg: ResolvedConfig,
  opts: { revalidate?: (r: MarketDataResult) => void } = {},
): Promise<MarketDataResult> {
  const cached = readCachedData(cfg);

  if (cached !== null && !cached.stale) {
    return cached;
  }

  if (cached !== null) {
    // 有过期缓存：先用旧的，后台刷新（不 await，失败静默）
    void fetchMarketData(cfg)
      .then((fresh) => {
        opts.revalidate?.(fresh);
      })
      .catch(() => {
        /* 后台刷新失败：继续用旧缓存 */
      });
    return cached;
  }

  // 无缓存：只能前台等（首次安装或清缓存后）
  return await fetchMarketData(cfg);
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

/** 拉取整合包数据（packs.json，与 plugins.json 同目录；失败静默返回空数组） */
export async function fetchPacksData(cfg: ResolvedConfig): Promise<DshPack[]> {
  // 只替换文件名而不是匹配 "plugins.json"：数据源可能是 plugins-lite.json，
  // 旧写法 replace(/plugins\.json/) 在 lite 地址上不命中 → 会去拉 plugins-lite.json 当 packs。
  const url = cfg.remoteUrl.replace(/[^/]*$/, "packs.json");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = (await res.json()) as { packs?: DshPack[] };
      return data.packs ?? [];
    }
  } catch {
    /* 整合包数据缺失不影响主流程 */
  }
  return [];
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
