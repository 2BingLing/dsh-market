/**
 * 用户画像：已装 + GitHub 加星 + 冷启动问卷 三层信号 → 标签权重
 * EMA 增量更新（α=0.3）；置信度 = 信号丰富度。
 */
import type { DshPlugin } from "@dsh-market/schema";
import type { InstalledPlugin, UserProfile } from "./types.js";
import { usableTags } from "./tags.js";

/** EMA 衰减系数（新信号占比） */
export const EMA_ALPHA = 0.3;

/** 各信号对置信度的贡献 */
const CONFIDENCE_PER_INSTALLED = 0.08;
const CONFIDENCE_PER_STARRED = 0.06;
const CONFIDENCE_QUIZ = 0.25;

/** 新建空画像 */
export function emptyProfile(): UserProfile {
  return {
    tags: {},
    sources: { installed: [], starred: [], quiz: [], installedPluginIds: [] },
    confidence: 0,
    modeOverride: "auto",
    updatedAt: new Date().toISOString(),
  };
}

/** 由已装插件构建标签贡献（每装一个：标签权重 +1，数量开方压缩） */
export function tagsFromInstalled(
  installed: InstalledPlugin[],
  market: DshPlugin[],
): Record<string, number> {
  const tags: Record<string, number> = {};
  const hit = installed.filter((i) => i.plugin !== null);
  const n = Math.sqrt(Math.max(1, hit.length));
  for (const item of hit) {
    for (const t of usableTags(item.plugin!)) {
      tags[t] = (tags[t] ?? 0) + 1 / n;
    }
  }
  return tags;
}

/** 由 GitHub 加星（命中收录的插件）构建标签贡献（权重略低于已装） */
export function tagsFromStarred(
  starredFullNames: string[],
  market: DshPlugin[],
): Record<string, number> {
  const tags: Record<string, number> = {};
  const lower = new Set(starredFullNames.map((s) => s.toLowerCase()));
  const hit = market.filter(
    (p) => lower.has(p.fullName.toLowerCase()) || lower.has(p.id.toLowerCase()),
  );
  const n = Math.sqrt(Math.max(1, hit.length));
  for (const p of hit) {
    for (const t of usableTags(p)) {
      tags[t] = (tags[t] ?? 0) + 0.7 / n;
    }
  }
  return tags;
}

/** 由问卷选中的标签构建贡献 */
export function tagsFromQuiz(pickedTags: string[]): Record<string, number> {
  const tags: Record<string, number> = {};
  for (const t of pickedTags) {
    tags[t] = (tags[t] ?? 0) + 1;
  }
  return tags;
}

/** EMA 合并新标签贡献到旧画像（标签级增量更新） */
export function mergeTags(
  old: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...old };
  for (const [tag, weight] of Object.entries(incoming)) {
    merged[tag] =
      (merged[tag] ?? 0) * (1 - EMA_ALPHA) + weight * EMA_ALPHA;
  }
  // 清理趋零标签
  for (const [tag, w] of Object.entries(merged)) {
    if (w < 0.01) delete merged[tag];
  }
  return merged;
}

/** 合并信号源列表（去重） */
function mergeUnique(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * 更新画像（增量）：
 * @param prev 旧画像（null 则新建）
 * @param market 市场数据
 * @param signals 本次会话的新信号
 */
export function updateProfile(
  prev: UserProfile | null,
  market: DshPlugin[],
  signals: {
    installed?: InstalledPlugin[];
    starredFullNames?: string[];
    quizTags?: string[];
  },
): UserProfile {
  const base = prev ?? emptyProfile();
  const incoming: Record<string, number> = {};

  const installedIds = signals.installed
    ? signals.installed.filter((i) => i.pluginId).map((i) => i.pluginId!)
    : [];
  const starredHit = signals.starredFullNames ?? [];

  if (signals.installed?.length) {
    Object.assign(incoming, tagsFromInstalled(signals.installed, market));
  }
  if (starredHit.length) {
    Object.assign(incoming, tagsFromStarred(starredHit, market));
  }
  if (signals.quizTags?.length) {
    Object.assign(incoming, tagsFromQuiz(signals.quizTags));
  }

  const tags = Object.keys(incoming).length
    ? mergeTags(base.tags, incoming)
    : base.tags;

  const sources = {
    installed: mergeUnique(
      base.sources.installed,
      signals.installed?.map((i) => i.localName) ?? [],
    ),
    starred: mergeUnique(base.sources.starred, starredHit),
    quiz: mergeUnique(base.sources.quiz, signals.quizTags ?? []),
    installedPluginIds: mergeUnique(base.sources.installedPluginIds, installedIds),
  };

  // 置信度：封顶 1
  const confidence = Math.min(
    1,
    sources.installed.length * CONFIDENCE_PER_INSTALLED +
      sources.starred.length * CONFIDENCE_PER_STARRED +
      (sources.quiz.length ? CONFIDENCE_QUIZ : 0),
  );

  return {
    tags,
    sources,
    confidence,
    modeOverride: base.modeOverride,
    updatedAt: new Date().toISOString(),
  };
}

/** 由画像判定推荐阶段（尊重手动覆盖） */
export function stageOf(profile: UserProfile): "novice" | "veteran" {
  if (profile.modeOverride !== "auto") return profile.modeOverride;
  return profile.confidence >= 0.4 ? "veteran" : "novice";
}

/** 画像前 N 个标签（展示用） */
export function topTags(profile: UserProfile, n = 12): string[] {
  return Object.entries(profile.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}
