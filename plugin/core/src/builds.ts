/**
 * 构建脚本放行（P0-2）
 *
 * pnpm ≥10 默认不执行依赖的构建脚本（prepare / postinstall / node-gyp / esbuild 等），
 * 原生依赖插件首次安装必失败（stderr 含 "Ignored build scripts: ..."）。本模块：
 *   1. 从安装失败输出中解析被拦的包名清单；
 *   2. 探测 pnpm 主版本选对配置键（≥11: allowBuilds；10: onlyBuiltDependencies）；
 *   3. 增量合并写 `<profileDir>/pnpm-workspace.yaml`（保留原内容，绝不覆盖）；
 * 搭配 UI「批准并重试」一键完成"最常见首装失败"的处理。
 *
 * 纯 Node 实现，可独立测试（文件读写走真实临时目录；pnpm 版本探测通过注入 runner）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./types.js";
import { getListBlock, getTrueMapBlock, mergeListBlock, mergeTrueMapBlock } from "./yaml-block.js";

/** 从 pnpm 输出解析被拦的构建脚本包名（去版本号） */
export function parseBlockedBuilds(output: string): string[] {
  if (!output) return [];
  const re = /Ignored\s+build\s+scripts\s*:\s*([^\n]*)/i;
  const m = output.match(re);
  if (!m) return [];
  return m[1]
    .replace(/\.\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(stripVersion);
}

/** 提取 pnpm 错误码（如 ERR_PNPM_NO_MATCHING_VERSION） */
export function parsePnpmErrorCode(output: string): string | null {
  if (!output) return null;
  const m = output.match(/ERR_PNPM_[A-Z0-9_]+/);
  return m ? m[0] : null;
}

/** 判定失败是否为"构建脚本被拦"（P0-4 前的可读信号） */
export function isBuildBlockedFailure(output: string): boolean {
  if (!output) return false;
  return (
    /Ignored\s+build\s+scripts/i.test(output) ||
    /approve[-_ ]?builds/i.test(output) ||
    /onlyBuiltDependencies|allowBuilds/i.test(output)
  );
}

/** 构造 pnpm-workspace.yaml 路径 */
export function pnpmWorkspacePath(profileDir: string): string {
  return join(profileDir, "pnpm-workspace.yaml");
}

/** 探测 pnpm 主版本（注入 runner；stdout 无法捕获时回退 10） */
export async function detectPnpmMajor(opts: {
  runner: CommandRunner;
  cwd?: string;
}): Promise<number> {
  try {
    const r = await opts.runner.run("pnpm --version", {
      cwd: opts.cwd,
      timeoutMs: 20_000,
    });
    const v = (r.stdout || r.stderr || "").trim().match(/(\d+)\./);
    if (v) return Number(v[1]);
  } catch {
    /* runner 失败 → 回退 */
  }
  return 10;
}

/** pnpm 主版本 → 配置键名 */
export function buildAllowKey(pnpmMajor: number): "allowBuilds" | "onlyBuiltDependencies" {
  return pnpmMajor >= 11 ? "allowBuilds" : "onlyBuiltDependencies";
}

/** 在 profileDir 的 pnpm-workspace.yaml 中合并放行包（保留原内容），返回变更信息 */
export function writeBuildApprovals(
  profileDir: string,
  packages: string[],
  opts: { pnpmMajor?: number; dryRun?: boolean } = {},
): { ok: boolean; key: string; merged: string[]; written: boolean; error?: string } {
  const key = buildAllowKey(opts.pnpmMajor ?? 10);
  const want = [...new Set(packages.map((p) => p.trim()).filter(Boolean))];
  if (want.length === 0) {
    return { ok: false, key, merged: [], written: false, error: "无可放行的包名" };
  }
  const file = pnpmWorkspacePath(profileDir);
  if (opts.dryRun) {
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    const merged = mergedPackages(existing, key, want);
    return { ok: true, key, merged, written: false };
  }
  try {
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    const next =
      key === "allowBuilds"
        ? mergeTrueMapBlock(existing, key, want)
        : mergeListBlock(existing, key, want);
    writeFileSync(file, next, "utf8");
    return { ok: true, key, merged: mergedPackages(next, key, []), written: true };
  } catch (err) {
    return { ok: false, key, merged: [], written: false, error: (err as Error).message };
  }
}

/** 读取当前已放行的包清单（allowBuilds=map / onlyBuiltDependencies=array，按 pnpm 主版本选键） */
export function readBuildApprovals(profileDir: string, pnpmMajor = 10): string[] {
  const file = pnpmWorkspacePath(profileDir);
  try {
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, "utf8");
    const key = buildAllowKey(pnpmMajor);
    return key === "allowBuilds"
      ? getTrueMapBlock(raw, key)
      : getListBlock(raw, key);
  } catch {
    return [];
  }
}

/** 从既有 yaml 提取合并后的包清单（测试/展示用） */
function mergedPackages(yaml: string, key: string, extra: string[]): string[] {
  const base = getListBlock(yaml, key);
  const all = [...base, ...extra.map(stripVersion)].map(normalize);
  return [...new Set(all)];
}

function stripVersion(s: string): string {
  return s.trim().replace(/@\d[\w.\-+]*$/, "");
}
function normalize(s: string): string {
  return s.trim().replace(/["']/g, "").toLowerCase();
}
