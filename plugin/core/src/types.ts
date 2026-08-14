/**
 * DSH Market 插件端核心层类型定义
 * 纯 Node 模块，零 DSH API 依赖。所有跨模块共享的类型集中于此。
 */
import type { DshPlugin } from "@dsh-market/schema";

/** 已装插件扫描结果 */
export interface InstalledPlugin {
  /** 命中市场收录时的插件 id（owner/repo），未收录则为 null */
  pluginId: string | null;
  /** 目录名（如 1password-1.0.1 或仓库名） */
  localName: string;
  /** 扫描到的版本（从目录名 name-version 推断，可能为空） */
  version: string | null;
  /** 安装来源：skills 目录 / profile 依赖 / 其他 */
  source: "skills" | "profile" | "other";
  /** 命中收录时的完整插件对象 */
  plugin: DshPlugin | null;
}

/** 用户画像：标签 → 权重 */
export interface UserProfile {
  tags: Record<string, number>;
  /** 信号来源明细 */
  sources: {
    installed: string[];
    starred: string[];
    quiz: string[];
    installedPluginIds: string[];
  };
  /** 画像置信度 0-1（信号丰富度） */
  confidence: number;
  /** 用户主动覆盖的模式（auto 表示自动推断） */
  modeOverride: "auto" | "novice" | "veteran";
  updatedAt: string;
}

/** 推荐阶段 */
export type Stage = "novice" | "veteran";

/** 推荐结果 */
export interface Recommendation {
  plugin: DshPlugin;
  /** 推荐分数（内部排序用） */
  score: number;
  /** 与画像的相似度 0-1 */
  relevance: number;
  /** 推荐理由（规则生成） */
  reasons: string[];
  /** 命中来源：scene/guess/curated/trending */
  origin: "scene" | "guess" | "curated" | "trending";
}

/** 安装步骤状态 */
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface InstallStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

/** 安装进度回调 */
export type StepCallback = (step: InstallStep) => void;

/** 安装选项 */
export interface InstallOptions {
  /** 是否允许覆盖已装（默认 false：已装则跳过） */
  force?: boolean;
  /** 是否模拟执行（默认 false：true 时不真正执行命令，用于测试/预览） */
  dryRun?: boolean;
  /** 目标 profile（cordis 型；默认取配置的 defaultProfile） */
  targetProfile?: string;
  /** 执行器：真实环境由 UI 层注入（Host 子进程），测试注入 mock */
  runner: CommandRunner;
  /** 步骤回调 */
  onStep?: StepCallback;
}

/** 命令执行器接口（注入式，保持核心层可测） */
export interface CommandRunner {
  /** 执行命令，返回退出码与输出；timeoutMs 超时抛错 */
  run(
    command: string,
    opts: { cwd?: string; timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** 安装回滚快照 */
export interface InstallSnapshot {
  pluginId: string;
  type: "skill" | "cordis-plugin";
  target: string;
  installedAt: string;
  /** skill 型：安装前目录是否存在 */
  existedBefore: boolean;
  /** cordis 型：安装前 package.json 内容；skill 型 force 时：备份目录路径 */
  packageJsonBefore: string | null;
  /** cordis 型：npm 包名（回滚 remove 用） */
  pkgName?: string;
}

/** 安装结果 */
export interface InstallResult {
  ok: boolean;
  steps: InstallStep[];
  /** 已装过（跳过） */
  alreadyInstalled?: boolean;
  /** 需要重启 harness 生效（cordis 型） */
  requiresRestart?: boolean;
  snapshot?: InstallSnapshot;
  error?: string;
}

/** 卸载结果 */
export interface UninstallResult {
  ok: boolean;
  error?: string;
}

/** 市场数据源配置 */
export interface DataSourceConfig {
  /** 远程数据 URL（线上 GitHub Pages） */
  remoteUrl: string;
  /** 本地兜底文件路径（开发用 data/plugins.json） */
  localPath?: string;
  /** 缓存目录（本地缓存市场数据） */
  cacheDir?: string;
  /** 缓存有效期 ms（默认 1h） */
  cacheTtlMs?: number;
}

/** 核心层总配置 */
export interface CoreConfig {
  /** DSH_HOME（默认 ~/.dsh，env DSH_HOME 优先） */
  dshHome?: string;
  /** skills 目录（默认 $DSH_HOME/skills，兼容旧版 ~/.agents/skills） */
  skillsDir?: string;
  /** profiles 目录（默认 $DSH_HOME/profiles） */
  profilesDir?: string;
  /** 插件数据目录（画像/快照/配置，默认 $DSH_HOME/plugins/dsh-market） */
  dataDir?: string;
  /** 默认目标 profile（cordis 型安装，默认自动检测 web） */
  defaultProfile?: string;
  /** 数据源 */
  dataSource?: Partial<DataSourceConfig>;
}

/** GitHub 绑定信息 */
export interface GitHubBinding {
  login: string | null;
  token: string | null;
  /** 绑定方式：device（设备流）/ pat */
  method: "device" | "pat" | null;
  boundAt: string | null;
}
