/**
 * 路由安装器（T0）：零 LLM 的最小安装路径。
 * 决策顺序：已装 → 配方缓存 → collector 解析命令；全部落空/失败才 needAi（升级 T1 协议子代理）。
 * 冒烟验证驱动升级：验证失败即视为"未通过"——不写配方、不更新 verifiedAt，交 AI 复核。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPlugin } from "@dsh-market/schema";
import type { CommandRunner, InstallResult, StepCallback } from "./types.js";
import { installPlugin, installPackageName, skillsDestName } from "./installer.js";
import type { ResolvedConfig } from "./config.js";
import {
  envFingerprint,
  isRecipeFresh,
  readRecipe,
  writeRecipe,
  type Recipe,
} from "./recipe.js";

export type RouterMode = "already" | "recipe" | "parsed" | "ai";

export interface RouterResult {
  /** 实际走的路径：already=已装跳过 · recipe=配方命中 · parsed=解析命令 · ai=需升级子代理 */
  mode: RouterMode;
  ok: boolean;
  /** 已装跳过 */
  alreadyInstalled?: boolean;
  /** true = 需要升级 T1 子代理（插件侧据此发起子代理） */
  needAi: boolean;
  /** 升级/失败原因（原样进 T1 提示词的「前序尝试」） */
  reason?: string;
  result?: InstallResult;
  recipe?: Recipe | null;
}

export interface RouteOptions {
  /** 目标 profile（cordis 型） */
  profile: string;
  /** 命令执行器（Host 注入） */
  runner: CommandRunner;
  /** 覆盖已装跳过 */
  force?: boolean;
  onStep?: StepCallback;
  /** 是否允许命中配方缓存（默认 true；false 用于诊断） */
  useRecipe?: boolean;
}

/** node 通用文件存在检查命令（Windows/POSIX 跨平台，DSH 环境必有 node） */
function existsCmd(path: string): string {
  return `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" ${JSON.stringify(path)}`;
}

/** node 通用依赖包含检查命令（profile package.json 的 dependencies 是否含包名） */
function depsCmd(pkgJsonPath: string, pkgName: string): string {
  return `node -e "const p=require(process.argv[1]);process.exit(p.dependencies&&p.dependencies[process.argv[2]]?0:1)" ${JSON.stringify(pkgJsonPath)} ${JSON.stringify(pkgName)}`;
}

/** 目标技能目录名（与 installer 的 <name>-latest 约定一致） */
function skillDest(cfg: ResolvedConfig, plugin: DshPlugin): string {
  return join(cfg.skillsDir, skillsDestName(plugin));
}

/** 推导冒烟命令：skill → 目录+SKILL.md 存在；cordis → profile 依赖含包名 */
export function deriveSmokeCommands(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  profile: string,
): string[] {
  if (plugin.type === "skill") {
    const dest = skillDest(cfg, plugin);
    return [existsCmd(dest), existsCmd(join(dest, "SKILL.md"))];
  }
  const pkgName = installPackageName(plugin);
  const pkgJsonPath = join(cfg.profilesDir, profile, "package.json");
  return [existsCmd(pkgJsonPath), depsCmd(pkgJsonPath, pkgName)];
}

/** 安装是否已完成（skill：目录存在；cordis：profile 依赖含包名） */
export function isInstalled(cfg: ResolvedConfig, plugin: DshPlugin, profile: string): boolean {
  if (plugin.type === "skill") return existsSync(skillDest(cfg, plugin));
  const pkgJsonPath = join(cfg.profilesDir, profile, "package.json");
  try {
    if (!existsSync(pkgJsonPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return pkg.dependencies?.[installPackageName(plugin)] != null;
  } catch {
    return false;
  }
}

/** 内置安装路径对应的规范命令（一键安装成功后学配方用） */
export function canonicalCommands(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  profile: string,
): string[] {
  if (plugin.type === "skill") {
    return [`git clone --depth 1 https://github.com/${plugin.fullName}.git ${skillDest(cfg, plugin)}`];
  }
  return [`dsh plugin --profile ${profile} add ${installPackageName(plugin)}`];
}

/** T0 路由安装：已装 → 配方 → 解析命令；全部落空/失败 → needAi */
export async function routeInstall(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  opts: RouteOptions,
): Promise<RouterResult> {
  const { profile, runner, force, onStep, useRecipe = true } = opts;

  // 0. 已装：直接跳过（零动作）
  if (!force && isInstalled(cfg, plugin, profile)) {
    return { mode: "already", ok: true, alreadyInstalled: true, needAi: false };
  }

  const install = (commands: string[], smoke: string[]) =>
    installPlugin(cfg, plugin, {
      commands,
      smoke,
      targetProfile: profile,
      runner,
      force,
      onStep,
    });

  // 1. 配方命中：环境指纹一致 + 未过期 + 类型一致 → 按配方执行
  if (useRecipe) {
    const recipe = readRecipe(cfg, plugin.id);
    if (
      recipe &&
      recipe.envFingerprint === envFingerprint() &&
      isRecipeFresh(recipe) &&
      recipe.commands.length > 0 &&
      recipe.type === plugin.type
    ) {
      const result = await install(
        recipe.commands,
        recipe.smoke.length > 0 ? recipe.smoke : deriveSmokeCommands(cfg, plugin, profile),
      );
      if (result.ok && !result.smokeFailed) {
        writeRecipe(cfg, { ...recipe, verifiedAt: new Date().toISOString(), lastSmoke: "pass" });
        return { mode: "recipe", ok: true, needAi: false, result, recipe };
      }
      const reason = result.smokeFailed
        ? "配方冒烟验证失败（可能已过期），交 AI 复核"
        : `配方安装失败：${result.error ?? "未知"}，交 AI 复核`;
      if (result.smokeFailed) writeRecipe(cfg, { ...recipe, lastSmoke: "fail" });
      return { mode: "recipe", ok: false, needAi: true, reason, result, recipe };
    }
  }

  // 2. collector 解析命令（plugins.json 的 install.commands；无则必须 AI）
  const parsed = plugin.install?.commands ?? [];
  if (parsed.length === 0) {
    return { mode: "ai", ok: false, needAi: true, reason: "市场数据无解析安装命令" };
  }

  const smoke = deriveSmokeCommands(cfg, plugin, profile);
  const result = await install(parsed, smoke);
  if (result.ok && !result.smokeFailed) {
    // 学习配方：本次实际执行的命令 + 推导冒烟 → 下次零 token
    const recipe: Recipe = {
      pluginId: plugin.id,
      version: null,
      envFingerprint: envFingerprint(),
      type: plugin.type,
      commands: parsed,
      smoke,
      learnedFrom: "parsed",
      verifiedAt: new Date().toISOString(),
      lastSmoke: "pass",
    };
    writeRecipe(cfg, recipe);
    return { mode: "parsed", ok: true, needAi: false, result, recipe };
  }

  return {
    mode: "parsed",
    ok: result.ok,
    needAi: true,
    reason: result.smokeFailed
      ? "解析命令已执行但冒烟验证失败，交 AI 复核"
      : `解析命令安装失败：${result.error ?? "未知"}，交 AI 复核`,
    result,
    recipe: null,
  };
}

/** 手动/子代理学习配方（T1 JSON verdict 落库 / 用户修正；命令不一定已验证 → lastSmoke=null） */
export function learnRecipe(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  profile: string,
  input: {
    commands: string[];
    smoke?: string[];
    config?: Recipe["config"];
    learnedFrom?: Recipe["learnedFrom"];
  },
): void {
  writeRecipe(cfg, {
    pluginId: plugin.id,
    version: null,
    envFingerprint: envFingerprint(),
    type: plugin.type,
    commands: input.commands,
    smoke: input.smoke ?? deriveSmokeCommands(cfg, plugin, profile),
    config: input.config,
    learnedFrom: input.learnedFrom ?? "t1",
    verifiedAt: new Date().toISOString(),
    lastSmoke: null,
  });
}

/** T1 子代理 JSON verdict（协议输出，见 plugin/ui 的 buildInstallPrompt） */
export interface InstallVerdict {
  ok?: boolean;
  commands?: string[];
  smoke?: string[];
  fail?: string;
  configNeeded?: { what?: string; hint?: string } | null;
  recipe?: { commands?: string[]; smoke?: string[] };
}

/** 解析 T1 子代理的严格 JSON verdict：容忍 ```json 围栏与前后杂文本；无 ok 字段视为无效 */
export function parseInstallVerdict(text: string): InstallVerdict | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>;
    if (typeof obj !== "object" || obj === null || typeof obj.ok !== "boolean") return null;
    const asStrArr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
    const cfg = obj.config_needed as Record<string, unknown> | null | undefined;
    const rec = obj.recipe as Record<string, unknown> | null | undefined;
    return {
      ok: obj.ok,
      commands: asStrArr(obj.commands),
      smoke: asStrArr(obj.smoke),
      fail: typeof obj.fail === "string" ? obj.fail : undefined,
      configNeeded:
        cfg && typeof cfg === "object"
          ? {
              what: typeof cfg.what === "string" ? cfg.what : undefined,
              hint: typeof cfg.hint === "string" ? cfg.hint : undefined,
            }
          : null,
      recipe:
        rec && typeof rec === "object"
          ? { commands: asStrArr(rec.commands), smoke: asStrArr(rec.smoke) }
          : undefined,
    };
  } catch {
    return null;
  }
}