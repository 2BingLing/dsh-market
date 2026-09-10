/**
 * 瘦身索引等价性测试（漂移安全网）
 *
 * 核心断言：把同一批插件分别喂给「全量」与「瘦身后」的数据，
 * `recommend()` 与 `search()` 的结果必须逐项一致。
 *
 * 这样将来若有人新写了读取某个被裁字段的代码，测试立刻变红——不需要人去记住
 * LITE_DROP_FIELDS 里有什么。
 */
import { describe, expect, it } from "vitest";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import { LITE_DROP_FIELDS, toLiteMarketData, toLitePlugin } from "../src/lite.js";
import { recommend } from "../src/recommend.js";
import { search } from "../src/search.js";

/** 造一条字段齐全的插件（覆盖 schema 里的主要字段） */
function plugin(over: Partial<DshPlugin> & { id: string }): DshPlugin {
  return {
    type: "cordis-plugin",
    name: over.id,
    fullName: `owner/${over.id}`,
    description: `An English description for ${over.id}`,
    descriptionZh: `中文简介 ${over.id}`,
    tags: ["效率工具", "开发辅助"],
    topics: ["dsh-plugin"],
    stars: 42,
    forks: 3,
    openIssues: 1,
    pushedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastCheckedAt: "2026-09-10T00:00:00.000Z",
    curated: true,
    curatedReason: "社区精选",
    readmeSummary: "很长的 README 摘要……".repeat(50),
    repo: `https://github.com/owner/${over.id}`,
    homepage: `https://example.com/${over.id}`,
    license: "MIT",
    language: "TypeScript",
    owner: "owner",
    introByAuthor: "作者自述",
    sources: ["topic"],
    score: {
      total: 77,
      breakdown: { maintain: 80, practical: 70, popularity: 60, ease: 90, signal: 85 },
      confidence: 0.8,
      explanation: "为什么推荐：维护活跃且易用",
    },
    install: {
      method: "pnpm-profile",
      commands: [`dsh plugin add ${over.id}`],
      needsConfig: false,
      target: "web",
      commandSource: "readme",
    },
    ...over,
  } as DshPlugin;
}

const FULL: DshPlugin[] = [
  plugin({ id: "dsh-alpha" }),
  plugin({ id: "dsh-beta", curated: false, stars: 5, install: { method: "skills-add", commands: [], needsConfig: true, target: "web", commandSource: "builtin" } as never }),
  plugin({ id: "dsh-gamma", tags: ["AI 增强"], pushedAt: "2020-01-01T00:00:00.000Z" }),
];

const PROFILE = {
  tags: { 效率工具: 3, 开发辅助: 1 },
  sources: { installed: [], starred: [], quiz: [], installedPluginIds: [] },
  confidence: 0.5,
  modeOverride: "auto" as const,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("toLitePlugin", () => {
  it("裁掉约定的字段，且保留插件端真正读取的字段", () => {
    const lite = toLitePlugin(FULL[0]) as unknown as Record<string, unknown>;

    for (const f of LITE_DROP_FIELDS) expect(lite).not.toHaveProperty(f);
    expect(lite.score).not.toHaveProperty("breakdown");
    expect(lite.score).not.toHaveProperty("explanation");
    expect(lite.install).not.toHaveProperty("commandSource");

    // 这些是 recommend / search / lite() 实际读取的，必须在
    for (const f of ["id", "type", "name", "fullName", "description", "descriptionZh",
      "tags", "stars", "pushedAt", "curated", "curatedReason"]) {
      expect(lite).toHaveProperty(f);
    }
    expect(lite.score).toMatchObject({ total: 77, confidence: 0.8 });
    expect(lite.install).toMatchObject({ method: "pnpm-profile", needsConfig: false, target: "web" });
  });

  it("不改动入参（纯函数）", () => {
    const before = JSON.stringify(FULL[0]);
    toLitePlugin(FULL[0]);
    expect(JSON.stringify(FULL[0])).toBe(before);
  });
});

describe("瘦身等价性（漂移安全网）", () => {
  const litePlugins = toLiteMarketData({ schemaVersion: 2, generatedAt: "", plugins: FULL, packs: [] } as MarketData).plugins;

  it("recommend() 结果逐项一致", () => {
    const a = recommend(FULL, PROFILE, { limit: 24 });
    const b = recommend(litePlugins, PROFILE, { limit: 24 });
    expect(b.map((r) => [r.plugin.id, r.score, r.origin])).toEqual(
      a.map((r) => [r.plugin.id, r.score, r.origin]),
    );
  });

  it("recommend() 的 reasons 一致", () => {
    const a = recommend(FULL, PROFILE, { limit: 24 });
    const b = recommend(litePlugins, PROFILE, { limit: 24 });
    expect(b.map((r) => r.reasons)).toEqual(a.map((r) => r.reasons));
  });

  it("search() 结果一致（英文 desc / 中文标签 / 名称三条路都走）", () => {
    for (const q of ["alpha", "中文简介", "效率工具", "dsh-gamma"]) {
      const a = search(FULL, q, { limit: 10 });
      const b = search(litePlugins, q, { limit: 10 });
      expect(b.map((r) => [r.plugin.id, r.relevance, r.tagHits])).toEqual(
        a.map((r) => [r.plugin.id, r.relevance, r.tagHits]),
      );
    }
  });
});
