/**
 * 核心层配置：路径解析 + 本地配置读写
 * 纯 Node 实现。所有路径基于 DSH_HOME（默认 ~/.dsh，env 可覆盖）。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { CoreConfig, GitHubBinding, UserProfile } from "./types.js";

const DEFAULT_REMOTE_URL =
  "https://2bingling.github.io/dsh-market/plugins.json";

export interface ResolvedConfig {
  dshHome: string;
  skillsDir: string;
  profilesDir: string;
  dataDir: string;
  defaultProfile: string;
  remoteUrl: string;
  localDataPath: string | null;
  cacheTtlMs: number;
}

/** 解析并归一化配置（路径不存在时按需创建目录） */
export function resolveConfig(config: CoreConfig = {}): ResolvedConfig {
  const dshHome =
    config.dshHome ??
    process.env.DSH_HOME ??
    join(homedir(), ".dsh");

  const skillsDir =
    config.skillsDir ??
    process.env.DSH_SKILLS_DIR ??
    pickFirstExisting([
      join(dshHome, "skills"),
      join(homedir(), ".agents", "skills"),
    ]) ??
    join(dshHome, "skills");

  const profilesDir =
    config.profilesDir ?? process.env.DSH_PROFILES_DIR ?? join(dshHome, "profiles");

  const dataDir =
    config.dataDir ?? process.env.DSH_MARKET_DATA_DIR ?? join(dshHome, "plugins", "dsh-market");

  return {
    dshHome,
    skillsDir,
    profilesDir,
    dataDir,
    defaultProfile: config.defaultProfile ?? "web",
    remoteUrl: config.dataSource?.remoteUrl ?? DEFAULT_REMOTE_URL,
    localDataPath: config.dataSource?.localPath ?? null,
    cacheTtlMs: config.dataSource?.cacheTtlMs ?? 60 * 60 * 1000,
  };
}

/** 在候选路径中选第一个存在的（兼容旧版 skills 位置） */
function pickFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** 确保数据目录存在 */
export function ensureDataDir(cfg: ResolvedConfig): string {
  if (!existsSync(cfg.dataDir)) mkdirSync(cfg.dataDir, { recursive: true });
  return cfg.dataDir;
}

// ---------- 本地状态读写（画像 / 绑定 / 模式覆盖） ----------

const PROFILE_FILE = "profile.json";
const BINDING_FILE = "binding.json";
const SETTINGS_FILE = "settings.json";

export interface LocalSettings {
  /** 用户手动覆盖的模式 */
  modeOverride: "auto" | "novice" | "veteran";
  /** 目标 profile */
  profile: string;
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/** 读取画像；无则返回 null */
export function readProfile(cfg: ResolvedConfig): UserProfile | null {
  return readJson<UserProfile>(join(ensureDataDir(cfg), PROFILE_FILE));
}

/** 写入画像 */
export function writeProfile(cfg: ResolvedConfig, profile: UserProfile): void {
  writeJson(join(ensureDataDir(cfg), PROFILE_FILE), profile);
}

/** 读取 GitHub 绑定 */
export function readBinding(cfg: ResolvedConfig): GitHubBinding | null {
  return readJson<GitHubBinding>(join(ensureDataDir(cfg), BINDING_FILE));
}

/** 写入 GitHub 绑定 */
export function writeBinding(cfg: ResolvedConfig, binding: GitHubBinding): void {
  writeJson(join(ensureDataDir(cfg), BINDING_FILE), binding);
}

/** 读取本地设置（默认值兜底） */
export function readSettings(cfg: ResolvedConfig): LocalSettings {
  const s = readJson<Partial<LocalSettings>>(join(ensureDataDir(cfg), SETTINGS_FILE));
  return {
    modeOverride: s?.modeOverride ?? "auto",
    profile: s?.profile ?? cfg.defaultProfile,
  };
}

/** 写入本地设置 */
export function writeSettings(cfg: ResolvedConfig, patch: Partial<LocalSettings>): void {
  const cur = readSettings(cfg);
  writeJson(join(ensureDataDir(cfg), SETTINGS_FILE), { ...cur, ...patch });
}

/** 回滚快照目录 */
export function snapshotDir(cfg: ResolvedConfig): string {
  return join(ensureDataDir(cfg), "snapshots");
}

/** 当前 harness 运行的 profile（尽力探测：env → 默认） */
export function detectActiveProfile(cfg: ResolvedConfig): string {
  return process.env.DSH_PROFILE ?? process.env.DSH_MARKET_PROFILE ?? cfg.defaultProfile;
}
