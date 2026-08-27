/**
 * Recipe 配方缓存（路由模式 P1 的核心资产）：
 * 一次成功安装沉淀为可复用配方 → write-once, read-many。
 * 命中需满足：pluginId 相同 + 环境指纹一致 + 未过期。
 * 纯 Node 模块，零 DSH API 依赖；配方是纯文本 JSON，可人工审查/删除。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.js";
import { ensureDataDir } from "./config.js";

/** 配方有效期：90 天（超期先重新冒烟，冒烟失败才重学） */
export const RECIPE_TTL_MS = 90 * 24 * 3600 * 1000;

export interface RecipeConfigBlock {
  /** env=环境变量配置 · file=配置文件 · none=无需配置 */
  type: "env" | "file" | "none";
  /** 需要向用户确认的配置项（API Key / Token 等） */
  prompt?: string;
  /** 配置模板（追加行 / env 名 / 文件片段） */
  snippet?: string;
  /** 配置后是否需要重启 harness */
  restart?: boolean;
}

export interface Recipe {
  pluginId: string;
  /** 安装来源版本（成功后回填；解析命令路径暂为 null） */
  version: string | null;
  /** 环境指纹（平台+shell+包管理器+Node 大版本 的哈希），不匹配不命中 */
  envFingerprint: string;
  /** 与 DshPlugin.type 一致（skill / cordis-plugin） */
  type: "skill" | "cordis-plugin";
  /** 有效安装命令（逐条执行，退出码 0 才继续） */
  commands: string[];
  /** 前置检查（可选；预留，P1 未启用） */
  precheck?: string[];
  /** 冒烟验证命令（全部退出码 0 才算验证通过） */
  smoke: string[];
  /** 配置提供块 */
  config?: RecipeConfigBlock;
  /** 配方来源：parsed=collector 解析/一键安装 · t1/t2=子代理学习 */
  learnedFrom: "parsed" | "t1" | "t2";
  /** 最近验证时间（冒烟通过即刷新） */
  verifiedAt: string;
  /** 最近一次冒烟结果 */
  lastSmoke: "pass" | "fail" | null;
}

/** 配方目录（dataDir/recipes） */
export function recipeDir(cfg: ResolvedConfig): string {
  return join(ensureDataDir(cfg), "recipes");
}

export function recipePath(cfg: ResolvedConfig, pluginId: string): string {
  return join(recipeDir(cfg), `${pluginId.replace(/[/\\]/g, "_")}.json`);
}

/** 常用包管理器/工具探测（环境指纹的一部分；结果进程级缓存） */
const PM_PROBES = ["npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "brew", "cargo", "go", "git", "dsh"];
const DETECT_CMD = process.platform === "win32" ? "where" : "which";

let pmProbeCache: string[] | null = null;
function detectPackageManagers(): string[] {
  if (pmProbeCache) return pmProbeCache;
  const found: string[] = [];
  for (const name of PM_PROBES) {
    try {
      const r = spawnSync(DETECT_CMD, [name], { timeout: 2000, stdio: "ignore" });
      if (r.status === 0) found.push(name);
    } catch {
      /* 探测失败忽略该工具 */
    }
  }
  pmProbeCache = found;
  return found;
}

/** djb2 稳定哈希（非加密用途） */
function djb2(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h;
}

let fpCache: string | null = null;

/** 环境指纹：平台 + shell + 包管理器集合 + Node 大版本 → 哈希 */
export function envFingerprint(): string {
  if (fpCache) return fpCache;
  const platform = process.platform;
  const shell =
    platform === "win32" ? "cmd" : (process.env.SHELL?.split(/[\\/]/).pop() ?? "sh");
  const pms = detectPackageManagers().sort();
  const raw = [platform, shell, `node${process.versions.node.split(".")[0]}`, ...pms].join("|");
  fpCache = djb2(raw).toString(16);
  return fpCache;
}

/** 读取配方；无/损坏返回 null */
export function readRecipe(cfg: ResolvedConfig, pluginId: string): Recipe | null {
  try {
    const file = recipePath(cfg, pluginId);
    if (!existsSync(file)) return null;
    const r = JSON.parse(readFileSync(file, "utf8")) as Recipe;
    return r && typeof r.pluginId === "string" ? r : null;
  } catch {
    return null;
  }
}

/** 写入配方（失败不抛出：配方不是安装的必要条件） */
export function writeRecipe(cfg: ResolvedConfig, recipe: Recipe): void {
  try {
    const dir = recipeDir(cfg);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(recipePath(cfg, recipe.pluginId), JSON.stringify(recipe, null, 2), "utf8");
  } catch {
    /* 配方写入失败不阻断安装 */
  }
}

/** 删除配方（供用户手动清理/修正） */
export function deleteRecipe(cfg: ResolvedConfig, pluginId: string): void {
  try {
    rmSync(recipePath(cfg, pluginId), { force: true });
  } catch {
    /* 忽略 */
  }
}

/** 列出全部配方（透明可审查） */
export function listRecipes(
  cfg: ResolvedConfig,
): Array<{
  pluginId: string;
  type: Recipe["type"];
  learnedFrom: Recipe["learnedFrom"];
  verifiedAt: string;
  lastSmoke: Recipe["lastSmoke"];
}> {
  try {
    const dir = recipeDir(cfg);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Recipe;
          return {
            pluginId: r.pluginId,
            type: r.type,
            learnedFrom: r.learnedFrom,
            verifiedAt: r.verifiedAt,
            lastSmoke: r.lastSmoke,
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  } catch {
    return [];
  }
}

/** 是否未过期（超期先重新冒烟，失败才重学） */
export function isRecipeFresh(recipe: Recipe, now = Date.now(), ttlMs = RECIPE_TTL_MS): boolean {
  const v = Date.parse(recipe.verifiedAt);
  return Number.isFinite(v) && now - v <= ttlMs;
}