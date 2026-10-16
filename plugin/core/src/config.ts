/**
 * 核心层配置：路径解析 + 本地配置读写
 * 纯 Node 实现。所有路径基于 DSH_HOME（默认 ~/.dsh，env 可覆盖）。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { CoreConfig, GitHubBinding, UserProfile } from "./types.js";

// 数据源默认走 GitHub Pages 仓库路径。注意（#249）：绑定自定义域名 dsh.market 后，
// github.io 不再直接 200——Pages 会 301 到 http://dsh.market（明文 http + 国内无加速，
// 实测 9KB 404 都要 20s+）。因此 data.ts 的取数候选必须带上 jsDelivr 镜像兜底，
// 这里只保留默认地址与镜像基座两个事实来源；宣传链接（README/issue 回复）用 dsh.market。
const DEFAULT_REMOTE_URL =
  "https://2bingling.github.io/dsh-market/plugins.json";

// 瘦身索引：collector 额外产出的 plugins-lite.json，只保留插件端真正读取的字段
// （去掉 readmeSummary / topics / score.breakdown / score.explanation 等，
//  gzip 传输量约降到全量的 43%）。插件端优先取它，404 时自动回退全量索引——
//  这样在数据管道尚未产出该文件时也不会把插件打挂。
const DEFAULT_LITE_URL =
  "https://2bingling.github.io/dsh-market/plugins-lite.json";

/**
 * #249 · jsDelivr 公共镜像基座：国内直连 GitHub Pages / dsh.market 常年不可达
 * （实测 lite 10MB 在 180s 内下不完），jsDelivr 同文件 1.7–7s。
 * gh 分支引用缓存 12h：市场数据每日 06:00 更新一次，最坏滞后半天，可接受。
 * 取数候选 = 默认地址 + 这些镜像（见 config.ts → withMirrors / data.ts → remoteCandidates）。
 */
export const MIRROR_BASES = [
  "https://cdn.jsdelivr.net/gh/2BingLing/dsh-market@master/web/public",
  "https://fastly.jsdelivr.net/gh/2BingLing/dsh-market@master/web/public",
] as const;

/**
 * 单地址 → [原地址, ...镜像地址]。
 * 仅对默认 Pages 地址套镜像；用户自定义源（env / config 传入）不认识 jsDelivr 上的
 * 对应文件，原样返回——自定义即用户自负其责。
 */
export function withMirrors(url: string): string[] {
  if (url !== DEFAULT_REMOTE_URL && url !== DEFAULT_LITE_URL) return [url];
  const file = url.split("/").pop()!;
  return [url, ...MIRROR_BASES.map((b) => `${b}/${file}`)];
}

export interface ResolvedConfig {
  dshHome: string;
  skillsDir: string;
  profilesDir: string;
  dataDir: string;
  defaultProfile: string;
  remoteUrl: string;
  /** 瘦身索引地址；与 remoteUrl 相同表示不启用 */
  liteUrl: string;
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
    // #249 · 数据源可配置：cordis config.dataSource（最显式）→ 环境变量（会话级）→ 默认 Pages。
    // 环境变量名与 DSH_MARKET_DATA_DIR 命名风格对齐。
    remoteUrl:
      config.dataSource?.remoteUrl ??
      process.env.DSH_MARKET_REMOTE_URL ??
      DEFAULT_REMOTE_URL,
    liteUrl:
      config.dataSource?.liteUrl ??
      process.env.DSH_MARKET_LITE_URL ??
      DEFAULT_LITE_URL,
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
