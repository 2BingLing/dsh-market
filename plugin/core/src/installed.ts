/**
 * 已装检测：skills 目录扫描 + profile 依赖扫描
 * 目录命名约定 name-version（如 1password-1.0.1）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";
import type { InstalledPlugin } from "./types.js";

/** 扫描已装插件，并与市场数据匹配 */
export function scanInstalled(
  cfg: ResolvedConfig,
  market?: MarketData | null,
): InstalledPlugin[] {
  const byName = new Map<string, DshPlugin>();
  const byFull = new Map<string, DshPlugin>();
  for (const p of market?.plugins ?? []) {
    byName.set(p.name.toLowerCase(), p);
    byFull.set(p.fullName.toLowerCase(), p);
  }

  const found: InstalledPlugin[] = [];

  // 1. skills 目录（name-version 目录名）
  if (existsSync(cfg.skillsDir)) {
    for (const entry of readdirSync(cfg.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const { baseName, version } = splitNameVersion(name);
      const plugin =
        byName.get(baseName.toLowerCase()) ??
        byName.get(name.toLowerCase()) ??
        null;
      found.push({
        pluginId: plugin?.id ?? null,
        localName: name,
        version,
        source: "skills",
        plugin,
      });
    }
  }

  // 2. profiles 依赖（package.json dependencies + dsh.profile.bundles）
  if (existsSync(cfg.profilesDir)) {
    for (const profile of readdirSync(cfg.profilesDir, { withFileTypes: true })) {
      if (!profile.isDirectory()) continue;
      const pkgPath = join(cfg.profilesDir, profile.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          dsh?: { profile?: { bundles?: string[] } };
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const [dep, ver] of Object.entries(deps)) {
          // 只关注看起来像 dsh 插件的依赖（dsh- 前缀或知名组织）
          if (!looksLikeDshPlugin(dep)) continue;
          const plugin = byName.get(dep.toLowerCase()) ?? byFull.get(dep.toLowerCase()) ?? null;
          found.push({
            pluginId: plugin?.id ?? null,
            localName: dep,
            version: ver.replace(/^[\^~]/, "") || null,
            source: "profile",
            plugin,
          });
        }
        // dsh.profile.bundles：组合包清单（官方基础包 @deepseek-ai/dsh-* 跳过）
        for (const bundle of pkg.dsh?.profile?.bundles ?? []) {
          if (!looksLikeDshPlugin(bundle)) continue;
          const plugin =
            byName.get(bundle.toLowerCase()) ??
            byFull.get(bundle.toLowerCase()) ??
            null;
          found.push({
            pluginId: plugin?.id ?? null,
            localName: bundle,
            version: null,
            source: "profile",
            plugin,
          });
        }
      } catch {
        /* 单个 profile 解析失败跳过 */
      }
    }
  }

  return found;
}

/** 目录名 name-version → { baseName, version } */
export function splitNameVersion(name: string): {
  baseName: string;
  version: string | null;
} {
  // 尝试从末尾匹配 -x.y.z（含 pre-release 段）
  const m = name.match(/^(.*?)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/);
  if (m) return { baseName: m[1], version: m[2] };
  return { baseName: name, version: null };
}

/** 官方基础组合包（非市场插件，扫描时排除） */
const OFFICIAL_BUNDLES = new Set([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-headless",
]);

/** 粗略判断一个依赖名是否像 DSH 插件（避免把 react/lodash 当插件） */
function looksLikeDshPlugin(dep: string): boolean {
  const lower = dep.toLowerCase();
  if (OFFICIAL_BUNDLES.has(dep)) return false;
  if (lower.startsWith("@deepseek-ai/dsh")) return true;
  if (lower.includes("dsh-")) return true;
  if (lower.startsWith("@dsh")) return true;
  if (lower.startsWith("dsh-")) return true;
  return false;
}
