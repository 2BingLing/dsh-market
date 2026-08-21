/**
 * 已装检测：skills 目录扫描 + profile 依赖扫描
 * 目录命名约定 name-version（如 1password-1.0.1）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";
import type { CommandRunner, InstalledPlugin } from "./types.js";

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
        const depNames = new Set(Object.keys(deps));
        for (const [dep, ver] of Object.entries(deps)) {
          // 只关注看起来像 dsh 插件的依赖（dsh- 前缀或知名组织）
          if (!looksLikeDshPlugin(dep)) continue;
          const plugin = byName.get(dep.toLowerCase()) ?? byFull.get(dep.toLowerCase()) ?? null;
          // 版本优先读 node_modules 实际安装版本（`*` 依赖也准），其次依赖声明；git URL/路径 → null
          const installedVer = readInstalledVersion(
            join(cfg.profilesDir, profile.name, "node_modules", dep),
          );
          const cleanVer = (installedVer ?? ver).replace(/^[\^~]/, "");
          const isSemver = /^\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(cleanVer);
          found.push({
            pluginId: plugin?.id ?? null,
            localName: dep,
            version: isSemver ? cleanVer : null,
            source: "profile",
            plugin,
          });
        }
        // dsh.profile.bundles：组合包清单（官方基础包 @deepseek-ai/dsh-* 跳过）
        // 已在 dependencies 中出现的包跳过（避免同一插件显示两条：依赖 + bundle）
        for (const bundle of pkg.dsh?.profile?.bundles ?? []) {
          if (!looksLikeDshPlugin(bundle)) continue;
          if (depNames.has(bundle)) continue; // 去重：依赖里已有版本信息
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

/** 读 node_modules 实际安装版本的 package.json version（npm 包目录；link/不存在返回 null） */
function readInstalledVersion(dir: string): string | null {
  try {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** 读某个 profile 下已装 npm 包的实际版本（供更新 before/after 对比、验证复用） */
export function readInstalledVersionForProfile(
  cfg: ResolvedConfig,
  profile: string,
  name: string,
): string | null {
  return readInstalledVersion(join(cfg.profilesDir, profile, "node_modules", name));
}

/** 读本地 git 目录当前 HEAD commit（skill 型更新 before/after 对比用） */
export function readLocalHeadCommit(
  runner: CommandRunner,
  dir: string,
): Promise<string | null> {
  return runner
    .run(`git -C "${dir}" rev-parse HEAD`, { timeoutMs: 15_000 })
    .then((r) => {
      const out = (r.stdout || r.stderr || "").trim();
      return r.exitCode === 0 && /^[0-9a-f]{40}$/i.test(out) ? out : null;
    })
    .catch(() => null);
}
