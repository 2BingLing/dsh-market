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
  CommandRunner,
  InstallOptions,
  InstallResult,
  InstallSnapshot,
  InstallStep,
  SmokeCheck,
  SmokeResult,
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
    let r: InstallResult;
    if (options.commands && options.commands.length > 0) {
      r = await installByCommands(cfg, plugin, options, step, steps);
    } else if (plugin.type === "skill") {
      r = await installSkill(cfg, plugin, options, step, steps);
    } else {
      r = await installCordis(cfg, plugin, options, step, steps);
    }
    // 装后冒烟验证（dryRun 不执行；已装跳过场景也会验证存量健康）
    if (r.ok && !options.dryRun && options.smoke && options.smoke.length > 0) {
      r.smoke = await runSmoke(options.smoke, options.runner);
      r.smokeFailed = r.smoke.some((s) => !s.ok);
    }
    return r;
  } catch (err) {
    step("failed", "安装失败", "failed", (err as Error).message);
    return fail((err as Error).message);
  }
}

/** 覆盖命令安装：逐条执行（collector 解析命令 / 配方命令）。
 *  不做内置 clone/add、不做内置已装检测（调用方路由先行判断）；无回滚（任意命令不可安全逆操作）。 */
async function installByCommands(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
  step: StepFn,
  steps: InstallStep[],
): Promise<InstallResult> {
  const commands = options.commands ?? [];
  const profile = options.targetProfile ?? cfg.defaultProfile;
  const stepId = "install";
  step(stepId, `执行 ${commands.length} 条安装命令`, "running");
  const snapshot: InstallSnapshot = {
    pluginId: plugin.id,
    type: plugin.type === "skill" ? "skill" : "cordis-plugin",
    target: profile,
    installedAt: new Date().toISOString(),
    existedBefore: false,
    packageJsonBefore: null,
  };
  try {
    for (let i = 0; i < commands.length; i++) {
      const id = `cmd-${i}`;
      step(id, commands[i], "running");
      await runWithRetry(options, step, id, commands[i], PLUGIN_ADD_TIMEOUT);
      step(id, commands[i], "done");
    }
    step(stepId, `执行 ${commands.length} 条安装命令`, "done");
    saveSnapshot(cfg, snapshot);
    return { ok: true, steps, snapshot, requiresRestart: plugin.type !== "skill" };
  } catch (err) {
    step(stepId, "执行安装命令", "failed", (err as Error).message);
    return { ok: false, steps, error: (err as Error).message };
  }
}

/** 冒烟验证：结构化检查进程内直查（零 shell、跨平台可靠）；命令字符串交给 shell（退出码 0 即通过） */
async function runSmoke(checks: SmokeCheck[], runner: CommandRunner): Promise<SmokeResult[]> {
  const out: SmokeResult[] = [];
  for (const check of checks) {
    if (typeof check === "string") {
      try {
        const r = await runner.run(check, { timeoutMs: 30_000 });
        out.push({
          label: check,
          command: check,
          ok: r.exitCode === 0,
          output: r.exitCode === 0 ? undefined : (r.stderr || r.stdout).slice(0, 300),
        });
      } catch (err) {
        out.push({ label: check, command: check, ok: false, output: (err as Error).message.slice(0, 300) });
      }
      continue;
    }
    if (check.type === "exists") {
      const ok = existsSync(check.path);
      out.push({
        label: check.label ?? check.path,
        command: `exists:${check.path}`,
        ok,
        output: ok ? undefined : `路径不存在：${check.path}`,
      });
      continue;
    }
    // deps：profile package.json 的 dependencies 含包名
    const label = check.label ?? `deps:${check.pkgName}`;
    try {
      const pkg = JSON.parse(readFileSync(check.pkgJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const ok = pkg.dependencies?.[check.pkgName] != null;
      out.push({
        label,
        command: `deps:${check.pkgJsonPath}#${check.pkgName}`,
        ok,
        output: ok ? undefined : `dependencies 不含 ${check.pkgName}`,
      });
    } catch (err) {
      out.push({
        label,
        command: `deps:${check.pkgJsonPath}#${check.pkgName}`,
        ok: false,
        output: (err as Error).message.slice(0, 200),
      });
    }
  }
  return out;
}

/** skill 型：git clone 到 skills 目录（<name>，与 harness 扫描约定一致，issue #102） */
async function installSkill(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  options: InstallOptions,
  step: StepFn,
  steps: InstallStep[],
): Promise<InstallResult> {
  const destName = skillsDestName(plugin);
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
        const errText = r.stderr || r.stdout;
        // 文件占用/权限类失败（运行中 harness 更新本 profile 的典型病）：不重试，
        // 直接失败并给可操作提示——避免"重试 3×180s"把界面拖成永久更新中
        if (isLockFailure(errText)) {
          throw new Error(
            `${errText.slice(0, 200)}\n[提示] 文件被占用：请先停止 harness 再执行该操作，或改用未运行的 profile。`,
          );
        }
        throw new Error(`命令退出码 ${r.exitCode}：${errText.slice(0, 500)}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (isLockFailure((err as Error).message)) throw err;
      if (attempt === MAX_RETRY) throw err;
    }
  }
  throw lastErr;
}

/** 是否为文件占用/权限类失败（Windows 上更新运行中 profile 的常见病；命中则不应重试） */
export function isLockFailure(outputOrMessage: string): boolean {
  return (
    /EPERM|EACCES|EBUSY|being used by another process|resource busy|in use by another|Access is denied|Cannot create file/i.test(
      outputOrMessage,
    )
  );
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

/**
 * 技能目录命名约定（issue #102）：与 harness 实际扫描/加载一致——无版本后缀。
 * 曾用 `<name>-latest`（旧），导致：装完 harness 可见性/冒烟/已装匹配全部错位、
 * splitNameVersion 也解析不了 `-latest`。所有路径一律走 skillsDestName 唯一出口。
 */
export const SKILL_DEST_SUFFIX = "";

/** skill 型安装目标目录名（唯一出口：installer/router/verify/update 共用） */
export function skillsDestName(plugin: DshPlugin): string {
  return `${plugin.name}${SKILL_DEST_SUFFIX}`;
}

/** 从插件推断 npm 包名（cordis 型）：优先 homepage npm 路径，其次 name */
export function installPackageName(plugin: DshPlugin): string {
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
        : join(cfg.skillsDir, skillsDestName(plugin));
      if (!existsSync(dest)) return { ok: true };
      if (options.dryRun) return { ok: true };
      await removeDirWithRetry(dest, options);
      // 旧约定残留目录（<name>-latest，issue #102 修复前的安装）一并清理，避免"双份技能"
      const legacy = join(cfg.skillsDir, `${plugin.name}-latest`);
      if (legacy !== dest && existsSync(legacy)) {
        await removeDirWithRetry(legacy, options);
      }
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
