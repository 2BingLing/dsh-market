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
  const index = buildMarketIndex(market);

  const found: InstalledPlugin[] = [];

  // 1. skills 目录（name-version 目录名）
  if (existsSync(cfg.skillsDir)) {
    for (const entry of readdirSync(cfg.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const { baseName, version } = splitNameVersion(name);
      const plugin =
        matchMarketPluginInIndex(baseName, index) ??
        matchMarketPluginInIndex(name, index) ??
        // issue #102 旧约定残留：<name>-latest（市场条目 name=<name>，去掉后缀可识别）
        (baseName.endsWith("-latest")
          ? matchMarketPluginInIndex(baseName.slice(0, -"-latest".length), index)
          : null);
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
          // 只关注可能成为市场插件的依赖（#288）：名字形态像 DSH 插件，或能直接在市场
          // 目录命中——目录本身即白名单，比名字前缀可靠（billion-context / @liustack/modlens
          // 这类无 dsh 前缀的收录插件此前永远漏判）。
          // 官方基础包必须先排除：scoped fallback 会把
          // @deepseek-ai/dsh-web-app 误命中第三方同名条目 frankshi2024/dsh-web-app。
          if (OFFICIAL_BUNDLES.has(dep)) continue;
          const plugin = matchMarketPluginInIndex(dep, index);
          if (!looksLikeDshPlugin(dep) && !plugin) continue;
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
          // #288 · 与 deps 循环同口径：官方包先排除，再放宽为「形态像 or 目录命中」
          if (OFFICIAL_BUNDLES.has(bundle)) continue;
          if (depNames.has(bundle)) continue; // 去重：依赖里已有版本信息
          const plugin = matchMarketPluginInIndex(bundle, index);
          if (!looksLikeDshPlugin(bundle) && !plugin) continue;
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

/**
 * 市场匹配索引。`byName` 保留同名条目的**全部**候选：
 * 市场里重名不同仓库的条目很多（如 dsh-context 同时挂着 bowenliang123/dsh-context
 * 和 qiangweiliu/dsh-context），早先的 `Map<string, DshPlugin>` 会让后者覆盖前者，
 * 于是「已装」被记到 0 星的同名条目上，用户真正安装的那张卡片永远显示「安装」。
 */
export interface MarketIndex {
  byName: Map<string, DshPlugin[]>;
  byFull: Map<string, DshPlugin>;
}

/** 由市场数据构建匹配索引 */
export function buildMarketIndex(market?: MarketData | null): MarketIndex {
  const byName = new Map<string, DshPlugin[]>();
  const byFull = new Map<string, DshPlugin>();
  for (const p of market?.plugins ?? []) {
    byFull.set(p.fullName.toLowerCase(), p);
    const key = p.name.toLowerCase();
    const bucket = byName.get(key);
    if (bucket) bucket.push(p);
    else byName.set(key, [p]);
  }
  return { byName, byFull };
}

/**
 * 用已装依赖名匹配市场条目（issue #56：兼容 scoped 包名的误判）。
 * 归一化口径：
 *   - 先按原名精确匹配 fullName / name（无 scope 或恰好同名）；同名多条目时按
 *     `pickBest` 消歧，不再由索引顺序决定；
 *   - 对 `@scope/pkg`：`scope/pkg` 对齐 `owner/repo`（GitHub owner 大小写不敏感）；
 *     再退回 `pkg` 对齐仓库名 `name`（npm 包名常等于仓库名）——但条目自己的安装
 *     命令声明了**另一个 scoped 包**时（如 dsh-remote/plugin 声明 `add @dsh-remote/plugin`），
 *     说明是另一个包，不能认领（否则 @dsh-market/plugin 会被记成 dsh-remote/plugin）。
 * 均未命中返回 null。
 */
export function matchMarketPluginInIndex(dep: string, index: MarketIndex): DshPlugin | null {
  const d = dep.toLowerCase();
  const directFull = index.byFull.get(d);
  if (directFull) return directFull;
  const directName = pickBest(index.byName.get(d), dep);
  if (directName) return directName;
  if (d.startsWith("@")) {
    // "@scope/pkg".split("/") = ["@scope","pkg"] —— @ 是首 token 前缀，需先去掉 @ 再拆
    const [scope, ...rest] = d.slice(1).split("/");
    const pkg = rest.join("/");
    if (pkg) {
      const byScopedFull = index.byFull.get(`${scope}/${pkg}`);
      if (byScopedFull) return byScopedFull;
      const candidates = (index.byName.get(pkg) ?? []).filter((p) => {
        const declared = declaredScopedSpecs(p);
        return declared.length === 0 || declared.includes(d);
      });
      return pickBest(candidates, dep);
    }
  }
  return null;
}

/**
 * 兼容旧签名（单值 byName / byFull 无法表达重名条目，仅保留给外部调用方）。
 * 新代码请用 buildMarketIndex + matchMarketPluginInIndex。
 */
export function matchMarketPlugin(
  dep: string,
  byName: ReadonlyMap<string, DshPlugin>,
  byFull: ReadonlyMap<string, DshPlugin>,
): DshPlugin | null {
  const index: MarketIndex = {
    byFull: new Map(byFull),
    byName: new Map([...byName].map(([k, v]) => [k, [v]] as const)),
  };
  return matchMarketPluginInIndex(dep, index);
}

/** 同名候选消歧：安装命令点名该包 > 精选 > 热度 > fullName 字典序（稳定，不依赖索引顺序） */
function pickBest(candidates: readonly DshPlugin[] | undefined, dep: string): DshPlugin | null {
  if (!candidates || candidates.length === 0) return null;
  const first = candidates[0];
  if (candidates.length === 1) return first ?? null;
  const d = dep.toLowerCase();
  return [...candidates].sort((a, b) => compareCandidates(a, b, d))[0] ?? null;
}

function compareCandidates(a: DshPlugin, b: DshPlugin, dep: string): number {
  const am = installSpecs(a).includes(dep) ? 1 : 0;
  const bm = installSpecs(b).includes(dep) ? 1 : 0;
  if (am !== bm) return bm - am;
  if (a.curated !== b.curated) return a.curated ? -1 : 1;
  if (a.stars !== b.stars) return b.stars - a.stars;
  return a.fullName.localeCompare(b.fullName);
}

/** 条目安装命令里出现的包名 token（去引号/标点/版本后缀，忽略选项与 URL） */
function installSpecs(p: DshPlugin): string[] {
  const out: string[] = [];
  for (const cmd of p.install?.commands ?? []) {
    for (const raw of cmd.split(/[\s"'`]+/)) {
      const token = raw.replace(/^[({\[]+|[)}\].;,:!?&|]+$/g, "").toLowerCase();
      if (!token || token.startsWith("-")) continue;
      if (token.includes("://") || token.startsWith("git+") || token.endsWith(".tgz")) continue;
      out.push(stripVersionSpec(token).replace(/^github:/, ""));
    }
  }
  return out;
}

/** 条目自己声明的 scoped 包名（如 @dsh-remote/plugin），用于识别「同名不同包」 */
function declaredScopedSpecs(p: DshPlugin): string[] {
  return installSpecs(p).filter((s) => /^@[^/]+\/[^/]+$/.test(s));
}

/** `pkg@1.2.3` / `@scope/pkg@latest` → 包名 */
function stripVersionSpec(spec: string): string {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return spec;
    const at = spec.indexOf("@", slash);
    return at === -1 ? spec : spec.slice(0, at);
  }
  const at = spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
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
