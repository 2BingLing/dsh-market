/**
 * 安装路由度量（设计稿 §10）：JSONL 事件日志 + 聚合摘要，全部零 LLM。
 * sessionChars 为 T1 子代理会话累计字符量（≈ token 粗略代理，约 4 字符/token）。
 * 目标数值：T0 命中率、AI 参与率、成功率、T1 平均会话量。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.js";
import { ensureDataDir } from "./config.js";

/** t1 事件的阶段：start=升级子代理 · done=子代理完成（有 verdict 或失败返回） */
export type InstallMetricPhase = "start" | "done";

export interface InstallMetricEvent {
  ts: string;
  pluginId: string;
  /** install=一键安装 · ai=AI 代理安装（路由式） */
  type: "install" | "ai";
  /** already=已装跳过 · recipe=配方命中 · parsed=解析命令 · t1=子代理 · direct=一键安装 */
  mode: "already" | "recipe" | "parsed" | "t1" | "direct";
  ok: boolean;
  /** ai 型 t1：启动/完成标记 */
  phase?: InstallMetricPhase;
  alreadyInstalled?: boolean;
  smokeFailed?: boolean;
  recipeLearned?: boolean;
  /** T1 完成：会话累计字符量（token 粗略代理） */
  sessionChars?: number;
  /** 失败/升级原因（可为 null） */
  error?: string | null;
}

export function metricsDir(cfg: ResolvedConfig): string {
  return join(ensureDataDir(cfg), "metrics");
}

const METRIC_FILE = "install-events.jsonl";

/** 追加一条度量事件（失败静默：度量不阻断安装） */
export function recordInstallMetric(cfg: ResolvedConfig, event: InstallMetricEvent): void {
  try {
    const dir = metricsDir(cfg);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, METRIC_FILE), JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* 忽略 */
  }
}

export interface MetricSummary {
  /** 全部事件数（含 start 阶段） */
  total: number;
  /** 按 mode 计数（t1 只计完成事件） */
  byMode: Record<string, number>;
  /** T0 命中率 = ai 型中非子代理占比（already+recipe+parsed）/ aiTotal */
  t0Rate: number;
  /** AI 参与率 = t1 完成事件 / aiTotal */
  aiRate: number;
  /** 整体成功率（一键安装 + ai 完成事件） */
  okRate: number;
  /** T1 会话字符均值（token 粗略代理），无数据为 null */
  avgSessionChars: number | null;
  /** 最近 10 条（倒序） */
  recent: InstallMetricEvent[];
}

/** 读全部事件（跳过损坏行） */
export function readMetrics(cfg: ResolvedConfig): InstallMetricEvent[] {
  try {
    const file = join(metricsDir(cfg), METRIC_FILE);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          const e = JSON.parse(l) as InstallMetricEvent;
          return e && typeof e.pluginId === "string" && typeof e.mode === "string" ? e : null;
        } catch {
          return null;
        }
      })
      .filter((e): e is InstallMetricEvent => e !== null);
  } catch {
    return [];
  }
}

/** 聚合摘要：t1 只统计 phase=done 的完成事件（start 仅作轨迹可见性） */
export function metricSummary(cfg: ResolvedConfig): MetricSummary {
  const events = readMetrics(cfg);
  const done = events.filter((e) => e.mode !== "t1" || e.phase === "done");
  const byMode: Record<string, number> = {};
  for (const e of done) byMode[e.mode] = (byMode[e.mode] ?? 0) + 1;
  const t1 = byMode.t1 ?? 0;
  const aiTotal = (byMode.already ?? 0) + (byMode.recipe ?? 0) + (byMode.parsed ?? 0) + t1;
  const ok = done.filter((e) => e.ok).length;
  const chars = done.filter((e) => e.sessionChars != null).map((e) => e.sessionChars as number);
  return {
    total: events.length,
    byMode,
    t0Rate: aiTotal > 0 ? (aiTotal - t1) / aiTotal : 0,
    aiRate: aiTotal > 0 ? t1 / aiTotal : 0,
    okRate: done.length > 0 ? ok / done.length : 0,
    avgSessionChars:
      chars.length > 0 ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : null,
    recent: events.slice(-10).reverse(),
  };
}