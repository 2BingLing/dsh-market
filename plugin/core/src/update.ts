/**
 * 已装插件更新检测（M4「已装管理：检测更新」）：
 * - cordis 型（profile 依赖）：npm registry latest 版本 vs 本地实际安装版本（semver 比较）
 * - skill 型（skills 目录）：GitHub 仓库 pushedAt vs 本地目录 mtime（远端有新提交 → 可更新）
 * 纯 Node 实现（global fetch，Node 18+），查询结果带内存缓存（默认 1h，force 绕过）。
 * 更新执行复用 installer（install force = 覆盖安装：cordis 重新 add，skill 备份后重新 clone）。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.js";
import type { InstalledPlugin } from "./types.js";

export interface UpdateCheckResult {
  /** 已装项本地名（skill 目录名 / npm 依赖名） */
  localName: string;
  /** 市场插件 id（未收录为 null） */
  pluginId: string | null;
  /** 检测方式：npm（cordis）/ github（skill）/ none（无法检测） */
  kind: "npm" | "github" | "none";
  /** 本地版本（npm）或本地目录 mtime ISO（github） */
  current: string | null;
  /** 远端最新版本（npm）或仓库 pushedAt ISO（github） */
  latest: string | null;
  /** 是否有新版本 */
  hasUpdate: boolean;
  /** 无法检测的原因 */
  error?: string;
}

const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 60 * 60 * 1000;

/** 内存缓存：npm latest / GitHub pushedAt（失败也缓存 null，避免反复请求） */
const cache = new Map<string, { value: string | null; at: number }>();

function cacheGet(key: string): string | null | undefined {
  const c = cache.get(key);
  if (!c) return undefined;
  if (Date.now() - c.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return c.value;
}

function cacheSet(key: string, value: string | null): void {
  cache.set(key, { value, at: Date.now() });
}

// ---------- semver ----------

/** 解析 semver（支持 v 前缀与预发布；build metadata 忽略），失败返回 null */
export function parseVersion(
  v: string,
): { nums: number[]; pre: string[] } | null {
  const m = v
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[\w.-]+)?$/);
  if (!m) return null;
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split(".") : [],
  };
}

/** semver 比较：a < b → -1，相等 → 0，a > b → 1；无法解析时字典序兜底 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  // 预发布：正式版 > 预发布；同段数字 < 字母，数字按数值、字母按字典序
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- 远端查询 ----------

/** 查询 npm registry 指定包的最新版本（带内存缓存；失败返回 null） */
export async function fetchNpmLatest(
  pkgName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const key = `npm:${pkgName}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetchImpl(`${NPM_REGISTRY}/${pkgName}/latest`, {
      headers: { "User-Agent": "dsh-market" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      cacheSet(key, null);
      return null;
    }
    const d = (await res.json()) as { version?: string };
    const version = typeof d.version === "string" ? d.version : null;
    cacheSet(key, version);
    return version;
  } catch {
    cacheSet(key, null);
    return null;
  }
}

/** 查询 GitHub 仓库 pushed_at（带内存缓存；失败返回 null） */
export async function fetchRepoPushedAt(
  fullName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const key = `gh:${fullName}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetchImpl(`${GITHUB_API}/repos/${fullName}`, {
      headers: { "User-Agent": "dsh-market" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      cacheSet(key, null);
      return null;
    }
    const d = (await res.json()) as { pushed_at?: string };
    const pushedAt = typeof d.pushed_at === "string" ? d.pushed_at : null;
    cacheSet(key, pushedAt);
    return pushedAt;
  } catch {
    cacheSet(key, null);
    return null;
  }
}

// ---------- 主入口 ----------

/** 已装插件更新检测（分批并发，默认每批 4 个请求，避免瞬时打满限额） */
export async function checkUpdates(
  cfg: ResolvedConfig,
  installed: InstalledPlugin[],
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<UpdateCheckResult[]> {
  if (opts.force) cache.clear();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const results: UpdateCheckResult[] = [];
  const batch = 4;
  for (let i = 0; i < installed.length; i += batch) {
    const chunk = installed.slice(i, i + batch);
    const out = await Promise.all(chunk.map((item) => checkOne(cfg, item, fetchImpl)));
    results.push(...out);
  }
  return results;
}

async function checkOne(
  cfg: ResolvedConfig,
  item: InstalledPlugin,
  fetchImpl: typeof fetch,
): Promise<UpdateCheckResult> {
  // cordis 型：本地实际版本 → npm registry 最新版本
  if (item.source === "profile") {
    if (!item.version) {
      return {
        localName: item.localName,
        pluginId: item.pluginId,
        kind: "none",
        current: null,
        latest: null,
        hasUpdate: false,
        error: "无法读取本地版本（git/本地路径依赖）",
      };
    }
    const latest = await fetchNpmLatest(item.localName, fetchImpl);
    if (!latest) {
      // npm 查不到（git tarball / 路径依赖 / 未发布 npm）：若被市场收录 → 降级 GitHub 检测
      if (item.plugin) {
        const dir = findPackageDir(cfg, item.localName);
        const pushedAt = await fetchRepoPushedAt(item.plugin.fullName, fetchImpl);
        if (pushedAt) {
          let mtimeMs: number | null = null;
          if (dir) {
            try {
              mtimeMs = statSync(dir).mtimeMs;
            } catch {
              mtimeMs = null;
            }
          }
          return {
            localName: item.localName,
            pluginId: item.pluginId,
            kind: "github",
            current: item.version,
            latest: pushedAt,
            hasUpdate: mtimeMs !== null && new Date(pushedAt).getTime() > mtimeMs,
          };
        }
      }
      return {
        localName: item.localName,
        pluginId: item.pluginId,
        kind: "none",
        current: item.version,
        latest: null,
        hasUpdate: false,
        error: "npm 查询失败或包不存在（且无法用 GitHub 检测）",
      };
    }
    return {
      localName: item.localName,
      pluginId: item.pluginId,
      kind: "npm",
      current: item.version,
      latest,
      hasUpdate: compareVersions(item.version, latest) < 0,
    };
  }

  // skill 型：GitHub pushedAt vs 本地目录 mtime（clone 完成后 mtime > pushedAt → 无更新；
  // 远端有新提交后 pushedAt > mtime → 可更新）
  if (item.source === "skills") {
    if (!item.plugin) {
      return {
        localName: item.localName,
        pluginId: item.pluginId,
        kind: "none",
        current: null,
        latest: null,
        hasUpdate: false,
        error: "未收录市场，无法检测",
      };
    }
    const pushedAt = await fetchRepoPushedAt(item.plugin.fullName, fetchImpl);
    if (!pushedAt) {
      return {
        localName: item.localName,
        pluginId: item.pluginId,
        kind: "none",
        current: null,
        latest: null,
        hasUpdate: false,
        error: "GitHub 查询失败",
      };
    }
    let mtimeMs: number | null = null;
    try {
      mtimeMs = statSync(join(cfg.skillsDir, item.localName)).mtimeMs;
    } catch {
      mtimeMs = null;
    }
    return {
      localName: item.localName,
      pluginId: item.pluginId,
      kind: "github",
      current: mtimeMs !== null ? new Date(mtimeMs).toISOString() : null,
      latest: pushedAt,
      hasUpdate: mtimeMs !== null && new Date(pushedAt).getTime() > mtimeMs,
    };
  }

  return {
    localName: item.localName,
    pluginId: item.pluginId,
    kind: "none",
    current: null,
    latest: null,
    hasUpdate: false,
    error: "未知来源",
  };
}

// ---------- 插件自身更新检测 ----------

/** 插件自身更新检测：npm 最新版 vs 当前安装版本（force 绕过 1h 内存缓存） */
export async function checkSelfUpdate(
  currentVersion: string,
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<{ current: string | null; latest: string | null; hasUpdate: boolean }> {
  if (opts.force) cache.clear();
  const latest = await fetchNpmLatest("@dsh-market/plugin", opts.fetchImpl ?? fetch);
  if (!latest) {
    return { current: currentVersion, latest: null, hasUpdate: false };
  }
  return {
    current: currentVersion,
    latest,
    hasUpdate: compareVersions(currentVersion, latest) < 0,
  };
}

// ---------- 辅助 ----------

/** 在 profiles 目录下定位已装包的 node_modules 目录（多 profile 遍历，第一个命中） */
function findPackageDir(cfg: ResolvedConfig, localName: string): string | null {
  try {
    for (const entry of readdirSync(cfg.profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(cfg.profilesDir, entry.name, "node_modules", localName);
      if (existsSync(p)) return p;
    }
  } catch {
    /* profiles 目录不存在 */
  }
  return null;
}
