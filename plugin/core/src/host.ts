/**
 * 本机 DSH 宿主版本探测（N2 · Host-aware 兼容门禁的另一半）
 *
 * 为什么需要"尽力探测"而不是直接读一个变量：DSH 没有一个稳定的「我是什么版本」注入点。
 * 实测（2026-09-12，本机 0.1.5-rc.1）：profile 的 package.json 里**没有** @deepseek-ai/*
 * 依赖（宿主 bundle 由运行时提供），profile/node_modules/@deepseek-ai 也不存在；
 * 能读到版本的地方是**全局 npm 目录的 @deepseek-ai/dsh 包**。
 *
 * 因此按可靠性从高到低依次尝试：
 *   1. DSH_VERSION 环境变量（显式覆盖，也便于测试与 CI）
 *   2. 运行进程溯源：从 process.argv[1] 向上找名为 @deepseek-ai/dsh* 的 package.json
 *      （插件本身跑在宿主进程里，这条在有正式安装时最贴近真实）
 *   3. 全局 npm 根目录（Windows %APPDATA%/npm/node_modules；类 Unix 常见前缀）
 *   4. profile 的 node_modules（若宿主包被 hoist 进来过）
 *
 * **读不到就返回 null**，调用方必须按"未知"处理（`checkDshCompat` 不会因此拦截安装）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ResolvedConfig } from "./config.js";

export type DshVersionSource = "env" | "runtime" | "global-npm" | "profile" | "unknown";

export interface DshVersionInfo {
  version: string | null;
  source: DshVersionSource;
  /** 找到版本的 package.json 路径（排障用） */
  from: string | null;
}

/** 宿主包名（DSH 内部 lockstep 同版本；`@deepseek-ai/dsh` 是用户可见的那个版本号） */
const HOST_PKG_NAMES = ["@deepseek-ai/dsh", "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];

function readPkgNameVersion(file: string): { name: string; version: string } | null {
  try {
    if (!existsSync(file)) return null;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown; version?: unknown };
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
    return { name: pkg.name, version: pkg.version };
  } catch {
    return null;
  }
}

/** 在一个 node_modules（或 npm root）目录下按优先级找宿主包 */
function probeRoot(nodeModulesDir: string): { version: string; from: string } | null {
  for (const name of HOST_PKG_NAMES) {
    const file = join(nodeModulesDir, ...name.split("/"), "package.json");
    const pv = readPkgNameVersion(file);
    // 名字必须真的是 DSH 宿主（防同名目录/损坏包）
    if (pv && pv.name.startsWith("@deepseek-ai/dsh")) return { version: pv.version, from: file };
  }
  return null;
}

/** 从运行进程的入口脚本向上找宿主包（最多 8 层，够 monorepo 深度） */
function probeRuntime(): { version: string; from: string } | null {
  const entry = process.argv[1];
  if (!entry) return null;
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    const pv = readPkgNameVersion(join(dir, "package.json"));
    if (pv && pv.name.startsWith("@deepseek-ai/dsh")) {
      return { version: pv.version, from: join(dir, "package.json") };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 全局 npm 根目录候选（Windows / 类 Unix / nvm 风格 / 自定义前缀） */
function globalNodeModulesCandidates(): string[] {
  const out: string[] = [];
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  out.push(join(appData, "npm", "node_modules"));
  // nvm / 自定义 prefix：npm 全局包在 node 安装目录的 lib/node_modules 下
  out.push(join(dirname(process.execPath), "..", "lib", "node_modules"));
  out.push("/usr/local/lib/node_modules");
  out.push("/usr/lib/node_modules");
  out.push(join(homedir(), ".npm-global", "lib", "node_modules"));
  const prefix = process.env.NPM_CONFIG_PREFIX;
  if (prefix) {
    out.push(join(prefix, "lib", "node_modules"));
    out.push(join(prefix, "node_modules"));
  }
  return out;
}

let cached: DshVersionInfo | null = null;

/** 清缓存（测试 / DSH 升级后重新探测用） */
export function resetDshVersionCache(): void {
  cached = null;
}

/**
 * 探测本机 DSH 宿主版本；读不到返回 `{ version: null, source: "unknown" }`。
 * 结果带缓存（运行期不会变），需要重探时先调 `resetDshVersionCache()`。
 */
export function detectDshVersion(cfg?: Pick<ResolvedConfig, "profilesDir" | "defaultProfile">): DshVersionInfo {
  if (cached) return cached;

  const envVersion = (process.env.DSH_VERSION ?? "").trim();
  if (envVersion) {
    cached = { version: envVersion, source: "env", from: "DSH_VERSION" };
    return cached;
  }

  const runtime = probeRuntime();
  if (runtime) {
    cached = { version: runtime.version, source: "runtime", from: runtime.from };
    return cached;
  }

  for (const dir of globalNodeModulesCandidates()) {
    const hit = probeRoot(dir);
    if (hit) {
      cached = { version: hit.version, source: "global-npm", from: hit.from };
      return cached;
    }
  }

  if (cfg) {
    const profile = process.env.DSH_PROFILE ?? cfg.defaultProfile;
    const hit = probeRoot(join(cfg.profilesDir, profile, "node_modules"));
    if (hit) {
      cached = { version: hit.version, source: "profile", from: hit.from };
      return cached;
    }
  }

  cached = { version: null, source: "unknown", from: null };
  return cached;
}
