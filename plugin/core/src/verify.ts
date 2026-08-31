/**
 * 装后四态生效验证（P0-1）
 *
 * 目标：装完立即知道"到底生效没有、为什么、还要做什么"，不再用"重启后生效"一刀切。
 * 真值 = <profileDir>/package.json 的 dsh.profile.bundles（DSH 插件 CLI reconcile 后的清单），
 * 配合已装包的 dsh.bundle / dsh.client 声明与 cordis.patch.yml 现状判定四态：
 *
 *   live    —— 已在 profile 层且 patch 已应用（可热加载）；skill 型目录存在即 live
 *   restart —— 已装且会生效，但需重启 harness（patch 未应用 / 纯客户端注入未加载）
 *   inert   —— 已装但不会成为插件层（普通依赖 / 声明了 dsh.bundle 却未进 bundles）
 *   broken  —— 安装完成但校验失败（依赖未写入 / node_modules 缺失）
 *
 * 纯 Node 实现，零 DSH 依赖，可独立测试。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DshPlugin } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";
import type { ActivationState, ActivationStatus } from "./types.js";
import { skillsDestName } from "./installer.js";

interface ProfilePackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: string[] } };
}

interface InstalledPackage {
  version?: string;
  dsh?: {
    bundle?: unknown;
    client?: unknown;
  };
  dshClient?: unknown;
  main?: string;
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 读 profile 的 package.json（依赖 + dsh.profile.bundles 真值） */
function readProfilePackage(cfg: ResolvedConfig, profile: string): ProfilePackage | null {
  return readJson<ProfilePackage>(join(cfg.profilesDir, profile, "package.json"));
}

/** 读已装包自身声明（node_modules/<name>/package.json） */
function readInstalledPackage(
  cfg: ResolvedConfig,
  profile: string,
  name: string,
): InstalledPackage | null {
  return readJson<InstalledPackage>(
    join(cfg.profilesDir, profile, "node_modules", name, "package.json"),
  );
}

/** 判断 cordis.patch.yml 是否已包含对某插件的插入行（patch 已应用 → 可热加载） */
function isPatchApplied(cfg: ResolvedConfig, profile: string, name: string): boolean {
  const patchPath = join(cfg.profilesDir, profile, "cordis.patch.yml");
  try {
    if (!existsSync(patchPath)) return false;
    const raw = readFileSync(patchPath, "utf8");
    // 插入行形态：`- id: <id>`（id 通常是包名或其短名；`name:` 是 cordis 插件元数据字段）
    const idLines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+(id|name):/.test(l));
    const nameLower = name.toLowerCase();
    return idLines.some((l) => {
      const v = l.replace(/^[-*]\s+(id|name):/, "").trim().replace(/["']/g, "");
      return v.toLowerCase() === nameLower || v.toLowerCase() === nameLower.replace(/^@[^/]+\//, "");
    });
  } catch {
    return false;
  }
}

/** cordis 型插件四态验证 */
function verifyCordis(
  cfg: ResolvedConfig,
  opts: { profile: string; name: string },
): ActivationStatus {
  const { profile, name } = opts;
  const profileDir = join(cfg.profilesDir, profile);

  if (!existsSync(profileDir)) {
    return {
      state: "broken",
      inBundles: false,
      hasBundle: false,
      hasClient: false,
      reasons: [`profile「${profile}」目录不存在`],
      action: "重新安装（目标 profile 无效）",
    };
  }

  const pkg = readProfilePackage(cfg, profile);
  if (!pkg) {
    return {
      state: "broken",
      inBundles: false,
      hasBundle: false,
      hasClient: false,
      reasons: [`${profileDir}/package.json 不存在或损坏`],
      action: "重新打开面板并再次尝试安装",
    };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const inBundles = bundles.some((b) => b.toLowerCase() === name.toLowerCase());

  if (!(name in deps) && !inBundles) {
    return {
      state: "broken",
      inBundles,
      hasBundle: false,
      hasClient: false,
      reasons: [`「${name}」不在 profile 依赖中，安装未生效`],
      action: "回到列表重新安装；仍有问题可导出安装日志反馈",
    };
  }

  const installed = readInstalledPackage(cfg, profile, name);
  if (!installed) {
    return {
      state: "broken",
      inBundles,
      hasBundle: false,
      hasClient: false,
      reasons: [`「${name}」未实际安装到 node_modules（可能被回滚/占用）`],
      action: "重新安装或检查磁盘占用后重试",
    };
  }

  const hasBundle = Boolean(installed.dsh?.bundle);
  const hasClient = Boolean(installed.dsh?.client) || Boolean(installed.dshClient);

  // 普通依赖：无 dsh.bundle / dsh.client → 不会成为插件层
  if (!hasBundle && !hasClient) {
    return {
      state: "inert",
      inBundles,
      hasBundle,
      hasClient,
      reasons: ["该依赖未声明 dsh.bundle / dsh.client", "作为普通依赖安装，不会成为 DSH 插件层"],
      action: "这不是可用的 DSH 插件包，建议卸载",
    };
  }

  // 声明了 dsh.bundle 却未进入 profile 真值 → 未生效
  if (hasBundle && !inBundles) {
    return {
      state: "inert",
      inBundles,
      hasBundle,
      hasClient,
      reasons: ["已声明 dsh.bundle，但未进入 dsh.profile.bundles", "插件尚未成为本 profile 的插件层"],
      action: "重启 harness 后仍未出现时，重新安装或联系维护者",
    };
  }

  // 纯客户端插件（dsh.client，无 bundle patch）→ 客户端注入重启后生效
  if (!hasBundle && hasClient) {
    return {
      state: "restart",
      inBundles,
      hasBundle,
      hasClient,
      reasons: ["纯客户端插件（dsh.client，无 bundle patch）"],
      action: "重启 harness 后客户端注入生效",
    };
  }

  // 已是正式插件层：patch 已应用 → live，否则 restart
  if (isPatchApplied(cfg, profile, name)) {
    return {
      state: "live",
      inBundles,
      hasBundle,
      hasClient,
      reasons: ["已进入 dsh.profile.bundles，且 cordis.patch.yml 已含该插件"],
      action: "已生效；若界面无变化请刷新页面或重启 harness",
    };
  }
  return {
    state: "restart",
    inBundles,
    hasBundle,
    hasClient,
    reasons: ["已安装并进入 profile 插件层", "patch 尚未应用，重启 harness 后生效"],
    action: "重启 harness 即可",
  };
}

/** 装后四态验证（通用入口：skill 目录存在即 live；cordis 走 verifyCordis） */
export function verifyActivation(
  cfg: ResolvedConfig,
  opts: {
    type: "skill" | "cordis-plugin";
    /** cordis 型：目标 profile */
    profile?: string;
    /** cordis 型：依赖键名（npm 包名），skill 型：技能目录名 */
    name: string;
  },
): ActivationStatus {
  if (opts.type === "skill") {
    const dir = join(cfg.skillsDir, opts.name);
    if (existsSync(dir)) {
      return {
        state: "live",
        inBundles: false,
        hasBundle: false,
        hasClient: false,
        reasons: [`技能已安装于 ${opts.name}`],
        action: "技能装好即用，无需重启",
      };
    }
    return {
      state: "broken",
      inBundles: false,
      hasBundle: false,
      hasClient: false,
      reasons: [`技能目录不存在：${opts.name}`],
      action: "回到列表重新安装",
    };
  }
  return verifyCordis(cfg, { profile: opts.profile ?? "web", name: opts.name });
}

/** 安装成功后做装后验证（installer 之外的薄封装：解析真实包名/目录名） */
export function verifyAfterInstall(
  cfg: ResolvedConfig,
  plugin: DshPlugin,
  opts: { profile?: string; skillDirName?: string },
): ActivationStatus {
  if (plugin.type === "skill") {
    const dirName = opts.skillDirName ?? skillsDestName(plugin);
    return verifyActivation(cfg, { type: "skill", name: dirName });
  }
  // cordis：真实依赖键名 = npm 包名（含 scope）
  const name = resolveInstallName(plugin);
  return verifyActivation(cfg, { type: "cordis-plugin", profile: opts.profile ?? "web", name });
}

/** 解析 cordis 插件的安装包名（npm 包名优先，其次仓库名） */
export function resolveInstallName(plugin: DshPlugin): string {
  const m = plugin.homepage?.match(/npmjs\.com\/package\/([\w@/-]+)/);
  if (m) return m[1];
  return plugin.name;
}

/** 状态 → 中文标签（UI 展示用） */
export const ACTIVATION_LABELS: Record<ActivationState, string> = {
  live: "已生效",
  restart: "重启后生效",
  inert: "未成为插件层",
  broken: "校验失败",
};
