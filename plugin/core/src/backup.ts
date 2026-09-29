/**
 * P5 备份/恢复：本地 JSON 导出 + 导入合并（WebDAV 每日自动 / Gist 同步后置）。
 *
 * 合并语义（对齐竞品 A 的恢复行为）：导入只**补装缺失**，绝不卸载/覆盖
 * 本机后来装的插件——备份是"下限"而不是"快照"。
 *
 * 边界约定：
 * - 备份只含 settings / 收藏 / 已装清单，**绝不含凭据**（GitHub token 只存
 *   浏览器 localStorage，binding.json 也不进备份）——避免"备份文件含凭据"的泄露面。
 * - 未收录/已下架的插件导出时保留人可读的名称快照，导入时归入 unmatched，
 *   不静默丢弃（报告里给得出"哪些没恢复、为什么"）。
 * - 恢复安装走 T0 确定性路由（routeInstall：已装 → 配方 → 解析命令），
 *   需要 AI 兜底的条目归入 failed 并带原因，导入流程保持零 LLM。
 */
import type { MarketData } from "@dsh-market/schema";
import type { ResolvedConfig } from "./config.js";
import { readSettings, writeSettings } from "./config.js";
import { scanInstalled } from "./installed.js";
import type { CommandRunner } from "./types.js";
import { routeInstall } from "./router.js";

export const BACKUP_KIND = "dsh-market-backup";
export const BACKUP_SCHEMA_VERSION = 1;

/** 备份里的一条已装记录 */
export interface BackupEntry {
  /** 市场插件 id（owner/repo）；导出时未收录为 null */
  pluginId: string | null;
  /** 本地名（cordis = 依赖键名，skill = 目录名） */
  localName: string;
  version: string | null;
  source: "skills" | "profile" | "other";
  /** 人可读快照（市场条目将来下架/改名时，备份文件本身仍可读） */
  pluginName?: string;
  fullName?: string;
}

/** 备份文件结构（导出产物 / 导入输入，同一份定义） */
export interface BackupFile {
  kind: typeof BACKUP_KIND;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  generatedAt: string;
  /** 导出时的插件市场版本（排障用） */
  appVersion?: string;
  settings?: {
    modeOverride?: "auto" | "novice" | "veteran";
    profile?: string;
  };
  /** 收藏（插件 id 列表；客户端 localStorage 的内容随备份走） */
  favorites?: string[];
  installed: BackupEntry[];
}

/** 导入结果（合并语义：already/unmatched/failed 都不是错误，是"为什么没装"的解释） */
export interface BackupImportResult {
  restored: string[];
  already: string[];
  failed: Array<{ pluginId: string; name: string; error: string }>;
  unmatched: BackupEntry[];
  /** 任一 cordis 型插件被恢复 → UI 提示重启 harness */
  requiresRestart: boolean;
}

/** 导入进度回调（逐条安装可能持续几分钟，UI 需要反馈） */
export type BackupImportProgress = (info: { done: number; total: number; name: string }) => void;

/** 构建备份对象（不落盘：文件写出由客户端触发下载，Host 不碰用户文件选择） */
export function buildBackup(
  cfg: ResolvedConfig,
  market: MarketData | null,
  opts: { appVersion?: string; favorites?: string[] } = {}
): BackupFile {
  const installed: BackupEntry[] = scanInstalled(cfg, market).map((i) => ({
    pluginId: i.pluginId,
    localName: i.localName,
    version: i.version,
    source: i.source,
    ...(i.plugin ? { pluginName: i.plugin.name, fullName: i.plugin.fullName } : {}),
  }));
  const s = readSettings(cfg);
  return {
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    settings: { modeOverride: s.modeOverride, profile: s.profile },
    ...(opts.favorites && opts.favorites.length > 0 ? { favorites: [...opts.favorites] } : {}),
    installed,
  };
}

/** 备份文件形状校验（导入前必过：坏文件给"不认识"而不是装到一半炸） */
export function isBackupFile(x: unknown): x is BackupFile {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    b.kind === BACKUP_KIND &&
    b.schemaVersion === BACKUP_SCHEMA_VERSION &&
    typeof b.generatedAt === "string" &&
    Array.isArray(b.installed)
  );
}

/**
 * 导入合并：对每条备份记录，已装 → already；市场已无 → unmatched；
 * 缺失 → T0 确定性安装。settings 有值时一并恢复（本地写 json，幂等）。
 */
export async function importBackup(
  cfg: ResolvedConfig,
  market: MarketData,
  backup: BackupFile,
  opts: {
    runner: CommandRunner;
    profile?: string;
    signal?: AbortSignal;
    onProgress?: BackupImportProgress;
  }
): Promise<BackupImportResult> {
  if (!isBackupFile(backup)) {
    throw new Error("不是有效的 dsh-market 备份文件（kind/schemaVersion 不匹配）");
  }
  const profile = opts.profile ?? backup.settings?.profile ?? readSettings(cfg).profile;

  if (backup.settings?.modeOverride || backup.settings?.profile) {
    writeSettings(cfg, {
      ...(backup.settings.modeOverride ? { modeOverride: backup.settings.modeOverride } : {}),
      ...(backup.settings.profile ? { profile: backup.settings.profile } : {}),
    });
  }

  const currentIds = new Set(
    scanInstalled(cfg, market)
      .map((i) => i.pluginId)
      .filter((x): x is string => Boolean(x))
  );
  const byId = new Map(market.plugins.map((p) => [p.id, p]));

  const result: BackupImportResult = {
    restored: [],
    already: [],
    failed: [],
    unmatched: [],
    requiresRestart: false,
  };

  const entries = backup.installed;
  let done = 0;
  for (const entry of entries) {
    const name = entry.pluginName ?? entry.fullName ?? entry.localName;
    opts.onProgress?.({ done, total: entries.length, name });
    const plugin = entry.pluginId ? byId.get(entry.pluginId) : undefined;
    if (!plugin) {
      result.unmatched.push(entry);
      done++;
      continue;
    }
    if (currentIds.has(plugin.id)) {
      result.already.push(plugin.id);
      done++;
      continue;
    }
    try {
      const r = await routeInstall(cfg, plugin, {
        profile,
        runner: opts.runner,
        signal: opts.signal,
      });
      if (r.ok && !r.needAi) {
        result.restored.push(plugin.id);
        if (r.result?.requiresRestart) result.requiresRestart = true;
      } else {
        result.failed.push({
          pluginId: plugin.id,
          name,
          error: r.reason ?? r.result?.error ?? "需要 AI 兜底安装（导入只走确定性路由）",
        });
      }
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      result.failed.push({ pluginId: plugin.id, name, error: (err as Error).message });
    }
    done++;
  }
  opts.onProgress?.({ done, total: entries.length, name: "" });
  return result;
}
