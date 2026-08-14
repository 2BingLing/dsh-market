/**
 * 推荐引擎：
 * - 分阶段：新手（高分精选 + 新手友好引导）/ 老手（标签相似 + 新颖 + MMR 多样性）
 * - 场景推荐：由会话上下文标签命中（harness 独有能力）
 * - 理由：规则生成
 */
import type { DshPlugin } from "@dsh-market/schema";
import type { Recommendation, UserProfile } from "./types.js";
import { usableTags } from "./tags.js";
import { stageOf } from "./profile.js";

/** MMR 多样性系数（λ=0.7：相关度为主，多样性为辅） */
export const MMR_LAMBDA = 0.7;
/** 新颖窗口：近 30 天更新视为"新" */
export const NOVEL_DAYS = 30;

export interface RecommendOptions {
  /** 已装插件 id（排除） */
  excludeIds?: string[];
  /** 会话场景标签（由 UI 层注入：正在使用的 skill 标签等） */
  sceneTags?: string[];
  /** 返回条数（默认 20） */
  limit?: number;
  /** 强制阶段（默认按画像推断） */
  stage?: "novice" | "veteran";
  /** 是否包含场景推荐（默认 true） */
  includeScene?: boolean;
  /** 参考时间（测试注入，默认 now） */
  now?: Date;
}

export interface SceneMatch {
  plugin: DshPlugin;
  hitTags: string[];
}

/**
 * 推荐主入口：返回按 origin 分组排序的推荐列表
 * 顺序：scene（场景命中）→ guess（画像猜测）→ curated/trending（兜底）
 */
export function recommend(
  plugins: DshPlugin[],
  profile: UserProfile,
  options: RecommendOptions = {},
): Recommendation[] {
  const now = options.now ?? new Date();
  const exclude = new Set(options.excludeIds ?? []);
  const pool = plugins.filter((p) => !exclude.has(p.id));
  const stage = options.stage ?? stageOf(profile);

  const out: Recommendation[] = [];

  // 1. 场景推荐（harness 独有：会话上下文命中）
  if (options.includeScene !== false && options.sceneTags?.length) {
    const scenes = findSceneMatches(pool, options.sceneTags, now);
    for (const s of scenes.slice(0, 3)) {
      out.push({
        plugin: s.plugin,
        score: 1000 + s.hitTags.length * 10,
        relevance: Math.min(1, s.hitTags.length / options.sceneTags.length),
        reasons: [
          `当前会话在用「${options.sceneTags.slice(0, 2).join("」「")}」相关功能`,
          ...buildGenericReasons(s.plugin, now),
        ],
        origin: "scene",
      });
    }
  }

  // 2. 猜你喜欢（画像相似）
  const guessed = stage === "novice" ? noviceGuess(pool, now) : veteranGuess(pool, profile, now);
  for (const g of guessed) {
    if (out.some((o) => o.plugin.id === g.plugin.id)) continue;
    out.push(g);
  }

  // 3. 兜底：精选 + 最新（补足数量）
  for (const p of pool) {
    if (out.length >= (options.limit ?? 20)) break;
    if (out.some((o) => o.plugin.id === p.id)) continue;
    if (p.curated) {
      out.push({
        plugin: p,
        score: 500 + p.score.total,
        relevance: 0,
        reasons: [p.curatedReason ?? "社区精选推荐"],
        origin: "curated",
      });
    }
  }
  if (out.length < (options.limit ?? 20)) {
    const newest = [...pool]
      .filter((p) => !out.some((o) => o.plugin.id === p.id))
      .sort(
        (a, b) =>
          new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
      );
    for (const p of newest) {
      if (out.length >= (options.limit ?? 20)) break;
      out.push({
        plugin: p,
        score: 100 + p.score.total,
        relevance: 0,
        reasons: ["最近更新活跃"],
        origin: "trending",
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** 场景匹配：标签命中数排序 */
export function findSceneMatches(
  pool: DshPlugin[],
  sceneTags: string[],
  now: Date,
): SceneMatch[] {
  return pool
    .map((p) => {
      const hitTags = sceneTags.filter((t) => looseTagHit(p, t));
      return { plugin: p, hitTags };
    })
    .filter((m) => m.hitTags.length > 0)
    .sort(
      (a, b) =>
        b.hitTags.length - a.hitTags.length ||
        b.plugin.score.total - a.plugin.score.total,
    );
}

/**
 * 宽松标签命中：标签精确/包含匹配 + 中文简介子串兜底
 * （collector 标签体系与用户自然语言词存在差异，如"飞书" vs "通知提醒"）
 */
export function looseTagHit(p: DshPlugin, tag: string): boolean {
  if (p.tags.includes(tag)) return true;
  if (p.tags.some((t) => t.includes(tag) || tag.includes(t))) return true;
  const zh = p.descriptionZh ?? "";
  if (zh && zh.includes(tag)) return true;
  return false;
}

/** 新手：高分精选 + 新手友好（needsConfig=false、无配置、高分） */
function noviceGuess(pool: DshPlugin[], now: Date): Recommendation[] {
  const scored = pool.map((p) => {
    let s = p.score.total;
    if (!p.install.needsConfig) s += 8;
    if (p.curated) s += 10;
    if (p.score.confidence > 0.5) s += 3;
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 10).map(({ p, s }) => ({
    plugin: p,
    score: s,
    relevance: 0,
    reasons: [
      p.install.needsConfig
        ? "高分实用插件（需要配置 API Key）"
        : "高分实用插件，开箱即用",
      ...buildGenericReasons(p, now),
    ],
    origin: "guess",
  }));
}

/** 老手：标签相似度 + 新颖度 + MMR 多样性 */
function veteranGuess(
  pool: DshPlugin[],
  profile: UserProfile,
  now: Date,
): Recommendation[] {
  const tagWeight = profile.tags;
  const profileTags = Object.keys(tagWeight);
  if (profileTags.length === 0) return [];

  // 相关度：标签加权余弦（plugin 向量 = 命中标签权重 1，profile 向量 = 标签权重）
  const relevant = pool.map((p) => {
    const pTags = usableTags(p);
    let dot = 0;
    let hits = 0;
    for (const t of pTags) {
      const w = tagWeight[t] ?? 0;
      if (w > 0) {
        dot += w;
        hits += 1;
      }
    }
    const profNorm = Object.values(tagWeight).reduce((a, b) => a + b * b, 0);
    const denom = Math.sqrt(hits) * Math.sqrt(profNorm);
    const similarity = denom === 0 ? 0 : Math.min(1, dot / denom);

    // 新颖度：近 NOVEL_DAYS 天更新 + 0.2
    const novel =
      now.getTime() - new Date(p.pushedAt).getTime() <= NOVEL_DAYS * 86400000
        ? 0.2
        : 0;
    // 实用分归一化 0-1 参与
    const scorePart = p.score.total / 100;
    return {
      p,
      similarity,
      relevance: similarity,
      novelty: novel,
      composite: similarity * 0.6 + scorePart * 0.2 + novel,
    };
  });

  // MMR 贪心选择：score = λ*rel - (1-λ)*maxSim(已选)
  const candidates = relevant
    .filter((r) => r.similarity > 0.02 || r.novelty > 0)
    .sort((a, b) => b.composite - a.composite);
  const selected: typeof candidates = [];
  const poolSet = [...candidates];

  while (poolSet.length && selected.length < 12) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < poolSet.length; i++) {
      const c = poolSet[i];
      let maxSim = 0;
      for (const s of selected) {
        const sim = tagSimilarity(usableTags(c.p), usableTags(s.p));
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = MMR_LAMBDA * c.composite - (1 - MMR_LAMBDA) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(poolSet[bestIdx]);
    poolSet.splice(bestIdx, 1);
  }

  return selected.map(({ p, similarity, novelty }) => ({
    plugin: p,
    score: 300 + similarity * 300 + novelty * 100,
    relevance: similarity,
    reasons: buildGuessReasons(p),
    origin: "guess",
  }));
}

/** 两插件标签集合相似度（Jaccard） */
function tagSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const inter = a.filter((t) => setB.has(t)).length;
  return inter / new Set([...a, ...b]).size;
}

/** 理由：基于画像的规则生成（短理由，避免拉长卡片） */
function buildGuessReasons(p: DshPlugin): string[] {
  const reasons: string[] = [];
  const recent = Date.now() - new Date(p.pushedAt).getTime() <= NOVEL_DAYS * 86400000;
  if (recent) reasons.push("近 30 天更新活跃");
  if (!p.install.needsConfig) reasons.push("开箱即用");
  return reasons;
}

/** 通用理由 */
function buildGenericReasons(p: DshPlugin, now: Date): string[] {
  const reasons: string[] = [];
  const recent = now.getTime() - new Date(p.pushedAt).getTime() <= NOVEL_DAYS * 86400000;
  if (recent) reasons.push("近 30 天更新活跃");
  if (!p.install.needsConfig) reasons.push("无需额外配置");
  return reasons;
}
