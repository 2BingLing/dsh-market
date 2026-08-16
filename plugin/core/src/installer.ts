/**
 * 确定性安装执行器：
 * - skill 型：git clone → skillsDir/<name>-<version>
 * - cordis 型：dsh plugin --profile <name> add <pkg>
 * 支持：分步进度回调、失败重试、安装前快照、回滚。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPlugin } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";
import { snapshotDir } from "./config.js";
import type {
  InstallOptions,
  InstallResult,
  InstallSnapshot,
  InstallStep,
  StepStatus,
} from "./types.js";

const MAX_RETRY = 2;
const SKILL_CLONE_TIMEOUT = 120_000;
const PLUGIN_ADD_TIMEOUT = 180_000;

type StepFn = (
  id: string,
  label?: string,
  status?: StepStatus,
  detail?: string,
) => InstallStep;

/** 安装插件 */
export async function installPlugin(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
): Promise<InstallResult> {
  const steps: InstallStep[] = [];
  const step = (id: string, label?: string, status?: StepStatus, detail?: string) => {
    const prev = steps.find((x) => x.id === id);
    const s: InstallStep = {
      id,
      label: label ?? prev?.label ?? id,
      status: status ?? prev?.status ?? "pending",
      detail,
    };
    const i = steps.findIndex((x) => x.id === id);
    if (i >= 0) steps[i] = s;
    else steps.push(s);
    options.onStep?.(s);
    return s;
  };

  const fail = (error: string): InstallResult => ({ ok: false, steps, error });

  try {
    if (plugin.type === "skill") {
      return await installSkill(cfg, plugin, options, step, steps);
    }
    return await installCordis(cfg, plugin, options, step, steps);
  } catch (err) {
    step("failed", "安装失败", "failed", (err as Error).message);
    return fail((err as Error).message);
  }
}

/** skill 型：git clone 到 skills 目录（<name>-latest，无版本信息时） */
async function installSkill(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
  step: StepFn,
  steps: InstallStep[],
): Promise<InstallResult> {
  const destName = `${plugin.name}-latest`;
  const dest = join(cfg.skillsDir, destName);
  const repoUrl = `https://github.com/${plugin.fullName}.git`;

  // 已装检测
  if (existsSync(dest)) {
    if (!options.force) {
      step("check", `已安装于 ${destName}`, "skipped", "已存在，跳过");
      return { ok: true, steps: [], alreadyInstalled: true };
    }
  }

  step("clone", `克隆 ${plugin.fullName}`, "running");
  const snapshot: InstallSnapshot = {
    pluginId: plugin.id,
    type: "skill",
    target: dest,
    installedAt: new Date().toISOString(),
    existedBefore: existsSync(dest),
    packageJsonBefore: null,
  };

  try {
    if (!options.dryRun) {
      if (!existsSync(cfg.skillsDir)) mkdirSync(cfg.skillsDir, { recursive: true });
      // 目标已存在且 force：先备份为 .bak
      if (snapshot.existedBefore) {
        step("backup", "备份旧版本", "running");
        const bak = `${dest}.bak-${Date.now()}`;
        const { renameSync } = await import("node:fs");
        renameSync(dest, bak);
        snapshot.packageJsonBefore = bak;
        step("backup", "备份旧版本", "done", bak);
      }
      await runWithRetry(
        options,
        step,
        "clone",
        `git clone --depth 1 ${repoUrl} ${dest}`,
        SKILL_CLONE_TIMEOUT,
      );
      step("clone", `克隆 ${plugin.fullName}`, "done");
    } else {
      step("clone", `克隆 ${plugin.fullName}`, "done", "(dry-run)");
    }
  } catch (err) {
    step("clone", `克隆 ${plugin.fullName}`, "failed", (err as Error).message);
    await rollbackSkill(cfg, snapshot, options, step);
    throw err;
  }

  saveSnapshot(cfg, snapshot);
  return { ok: true, steps, snapshot };
}

/** cordis 型：dsh plugin --profile <name> add <pkg> */
async function installCordis(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
  step: StepFn,
  steps: InstallStep[],
): Promise<InstallResult> {
  const profile = options.targetProfile ?? cfg.defaultProfile;
  const pkgName = installPackageName(plugin);
  const profileDir = join(cfg.profilesDir, profile);
  const pkgJsonPath = join(profileDir, "package.json");

  // 已装检测：package.json 依赖里已有该包
  const pkgJson = existsSync(pkgJsonPath)
    ? (JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      })
    : null;
  const already = pkgJson?.dependencies?.[pkgName] != null;

  if (already && !options.force) {
    step("check", `已安装 ${pkgName}`, "skipped", "已在 profile 依赖中");
    return { ok: true, steps: [], alreadyInstalled: true };
  }

  // 快照：安装前 package.json
  const snapshot: InstallSnapshot = {
    pluginId: plugin.id,
    type: "cordis-plugin",
    target: profile,
    installedAt: new Date().toISOString(),
    existedBefore: already,
    packageJsonBefore: pkgJson ? JSON.stringify(pkgJson, null, 2) : null,
    pkgName,
  };

  step("add", `安装 ${pkgName} 到 profile「${profile}」`, "running");
  try {
    const cmd = `dsh plugin --profile ${profile} add ${pkgName}`;
    if (!options.dryRun) {
      await runWithRetry(options, step, "add", cmd, PLUGIN_ADD_TIMEOUT);
      step("add", `安装 ${pkgName} 到 profile「${profile}」`, "done");
    } else {
      step("add", `安装 ${pkgName} 到 profile「${profile}」`, "done", "(dry-run)");
    }
  } catch (err) {
    step("add", `安装 ${pkgName} 到 profile「${profile}」`, "failed", (err as Error).message);
    await rollbackCordis(cfg, snapshot, options, step);
    throw err;
  }

  saveSnapshot(cfg, snapshot);
  return {
    ok: true,
    steps,
    snapshot,
    requiresRestart: true,
  };
}

/** 带重试的命令执行 */
async function runWithRetry(
  options: InstallOptions,
  step: StepFn,
  stepId: string,
  command: string,
  timeoutMs: number,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    if (attempt > 0) {
      step(stepId, undefined, "running", `重试 ${attempt}/${MAX_RETRY}`);
    }
    try {
      const r = await options.runner.run(command, { timeoutMs });
      if (r.exitCode !== 0) {
        throw new Error(
          `命令退出码 ${r.exitCode}：${(r.stderr || r.stdout).slice(0, 500)}`,
        );
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRY) throw err;
    }
  }
  throw lastErr;
}

/** skill 回滚：删除新目录 / 恢复备份 */
async function rollbackSkill(
  cfg: ResolvedConfig,
  snapshot: InstallSnapshot,
  options: InstallOptions,
  step: StepFn,
): Promise<void> {
  if (options.dryRun) return;
  const { renameSync } = await import("node:fs");
  step("rollback", "回滚", "running");
  if (snapshot.packageJsonBefore) {
    // 有备份：删掉新目录，恢复备份
    if (existsSync(snapshot.target)) {
      await removeDirWithRetry(snapshot.target, options);
    }
    renameSync(snapshot.packageJsonBefore, snapshot.target);
  } else if (!snapshot.existedBefore && existsSync(snapshot.target)) {
    await removeDirWithRetry(snapshot.target, options);
  }
  step("rollback", "回滚", "done");
}

/** cordis 回滚：dsh plugin remove + 还原 package.json */
async function rollbackCordis(
  cfg: ResolvedConfig,
  snapshot: InstallSnapshot,
  options: InstallOptions,
  step: StepFn,
): Promise<void> {
  if (options.dryRun) return;
  step("rollback", "回滚", "running");
  try {
    if (snapshot.pkgName) {
      await options.runner.run(
        `dsh plugin --profile ${snapshot.target} remove ${snapshot.pkgName}`,
        { timeoutMs: 120_000 },
      );
    }
  } catch {
    /* remove 失败则用 package.json 还原 */
  }
  if (snapshot.packageJsonBefore && snapshot.packageJsonBefore.startsWith("{")) {
    const pkgJsonPath = join(cfg.profilesDir, snapshot.target, "package.json");
    writeFileSync(pkgJsonPath, snapshot.packageJsonBefore, "utf8");
  }
  step("rollback", "回滚", "done");
}

/** 从插件推断 npm 包名（cordis 型）：优先 homepage npm 路径，其次 name */
function installPackageName(plugin: DshPlugin): string {
  const m = plugin.homepage?.match(/npmjs\.com\/package\/([\w@/-]+)/);
  if (m) return m[1];
  return plugin.name;
}

/** 保存快照到磁盘 */
function saveSnapshot(cfg: ResolvedConfig, snapshot: InstallSnapshot): void {
  try {
    const dir = snapshotDir(cfg);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `${snapshot.pluginId.replace(/[/\\]/g, "_")}-${Date.now()}.json`,
    );
    writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  } catch {
    /* 快照写入失败不阻断 */
  }
}

/** 删除目录（带重试 + 系统命令兜底，Windows 上 fs 删除可能被占用/拦截） */
async function removeDirWithRetry(
  dest: string,
  options: InstallOptions,
  attempts = 5,
): Promise<void> {
  const { rmSync } = await import("node:fs");
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      /* 继续重试 */
    }
    if (!existsSync(dest)) return;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800));
  }
  // fs 失败后系统命令兜底
  const cmd = process.platform === "win32" ? `rmdir /s /q "${dest}"` : `rm -rf "${dest}"`;
  await options.runner.run(cmd, { timeoutMs: 60000 });
  if (existsSync(dest)) {
    throw new Error(`目录删除失败（可能被占用）: ${dest}`);
  }
}

/** 卸载（skill 型：删目录；cordis 型：dsh plugin remove） */
export async function uninstallPlugin(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (plugin.type === "skill") {
      // 优先用已装目录名（localName），与 scanInstalled 的目录名一致
      const dest = options.localName
        ? join(cfg.skillsDir, options.localName)
        : join(cfg.skillsDir, `${plugin.name}-latest`);
      if (!existsSync(dest)) return { ok: true };
      if (options.dryRun) return { ok: true };
      await removeDirWithRetry(dest, options);
      return { ok: true };
    }
    const profile = options.targetProfile ?? cfg.defaultProfile;
    // 优先用已装依赖键名（localName）：pnpm remove 对键名大小写敏感，
    // plugin.name 是 GitHub 仓库原始大小写（如 DSH-better-sidebar），直接用它卸载会找不到依赖
    const pkgName = options.localName ?? installPackageName(plugin);
    if (options.dryRun) return { ok: true };
    const r = await options.runner.run(
      `dsh plugin --profile ${profile} remove ${pkgName}`,
      { timeoutMs: 120_000 },
    );
    if (r.exitCode !== 0) {
      return { ok: false, error: r.stderr || r.stdout };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
