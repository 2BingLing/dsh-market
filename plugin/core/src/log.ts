/**
 * P6 操作日志（就地日志导出的数据源）。
 *
 * 记录安装/更新/卸载等关键操作的结果（含失败分类 code），落成 JSONL：
 * `<dataDir>/logs/market-oplog.jsonl`。
 *
 * 设计约束：
 * - **追加日志绝不抛错**——日志失败不能影响主流程（静默放弃本次写入）；
 * - **容量封顶**：超过 512KB 轮转为 `.old`（只留一代），不会无限膨胀；
 * - 导出头自带**宿主版本 + 探测来源 + 时区**（P6 spec：日志含宿主版本、来源、时区），
 *   用户截图/粘贴给别人时不需要再解释环境。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDataDir, type ResolvedConfig } from "./config.js";
import { detectDshVersion } from "./host.js";

const LOG_DIR = "logs";
const LOG_FILE = "market-oplog.jsonl";
/** 单文件上限：超过即轮转为 .old（只留一代） */
const MAX_BYTES = 512 * 1024;
/** 单条 detail 截断长度（pnpm 输出可能很长，日志里留尾部够定位即可） */
const DETAIL_MAX = 500;

export interface OpLogEntry {
  /** ISO 时间 */
  t: string;
  /** 操作名：install / update / uninstall / ai-install … */
  op: string;
  ok: boolean;
  /** 失败分类 code（P6 classifyFailure；成功时无） */
  code?: string;
  /** 人话摘要（≤120 字符） */
  msg?: string;
  /** 目标插件（可写 pluginId） */
  target?: string;
  /** 原始输出尾部（≤500 字符，仅失败时） */
  detail?: string;
}

function logPath(cfg: ResolvedConfig): string {
  return join(ensureDataDir(cfg), LOG_DIR, LOG_FILE);
}

/** 追加一条操作日志；任何失败静默放弃（日志永不能拖垮主流程） */
export function appendOpLog(cfg: ResolvedConfig, entry: OpLogEntry): void {
  try {
    const dir = join(ensureDataDir(cfg), LOG_DIR);
    const file = logPath(cfg);
    mkdirSync(dir, { recursive: true });
    // 轮转：超过上限就把当前文件改名 .old，从空文件继续
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > MAX_BYTES) {
        try {
          renameSync(file, `${file}.old`);
        } catch {
          /* .old 被占用等：放弃本轮轮转，继续追加（下轮再试） */
        }
      }
    }
    const line = JSON.stringify({
      ...entry,
      msg: entry.msg?.slice(0, 120),
      detail: entry.detail?.slice(-DETAIL_MAX),
    });
    appendFileSync(file, `${line}\n`, "utf-8");
  } catch {
    /* 静默：日志写入失败不影响主流程 */
  }
}

/** 读最近 n 条（文件缺失/个别行损坏都容忍——坏行跳过） */
export function readOpLogTail(cfg: ResolvedConfig, n = 200): OpLogEntry[] {
  const out: OpLogEntry[] = [];
  try {
    const file = logPath(cfg);
    if (!existsSync(file)) return out;
    const lines = readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      try {
        out.unshift(JSON.parse(lines[i]) as OpLogEntry);
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    /* 读不到就返回空 */
  }
  return out;
}

/**
 * 导出为可直接粘贴/截图的文本。`versions` 由调用方传（ui 侧 readVersions
 * 有 plugin/core/schema 三件套），core 自己只知道自己的版本。
 */
export function exportLogText(
  cfg: ResolvedConfig,
  versions?: Record<string, string>
): string {
  const host = detectDshVersion(cfg);
  let tz = "?";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "?";
  } catch {
    /* ignore */
  }
  const entries = readOpLogTail(cfg, 200);
  const header = [
    "【插件市场操作日志】",
    `导出时间: ${new Date().toISOString()}`,
    `时区: ${tz}`,
    `DSH 宿主: ${host.version ?? "未知"}（探测来源: ${host.source}）`,
    `运行时: node ${process.version} / ${process.platform}/${process.arch}`,
    versions
      ? `版本: ${Object.entries(versions)
          .map(([k, v]) => `${k.replace("@dsh-market/", "")} ${v}`)
          .join(" · ")}`
      : "",
    `条目: 最近 ${entries.length} 条（单文件上限 512KB，轮转 1 代）`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const body =
    entries.length === 0
      ? "（暂无记录）"
      : entries
          .map((e) => {
            const head = `[${e.t}] ${e.op} ${e.ok ? "OK" : `失败(${e.code ?? "?"})`}${
              e.target ? ` ${e.target}` : ""
            }${e.msg ? ` — ${e.msg}` : ""}`;
            return e.detail && !e.ok ? `${head}\n    ${e.detail.split(/\r?\n/).join("\n    ")}` : head;
          })
          .join("\n");
  return `${header}${body}`;
}
