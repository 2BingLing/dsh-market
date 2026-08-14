import { describe, expect, it } from "vitest";
import { recommend, findSceneMatches } from "../src/recommend.js";
import { emptyProfile, updateProfile } from "../src/profile.js";
import type { UserProfile } from "../src/types.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();
const plugins = market.plugins;

function profileWith(tags: Record<string, number>, confidence = 0.8): UserProfile {
  return {
    tags,
    sources: { installed: [], starred: [], quiz: [], installedPluginIds: [] },
    confidence,
    modeOverride: "auto",
    updatedAt: new Date().toISOString(),
  };
}

describe("recommend", () => {
  it("新手模式：高分精选优先 + 新手友好（无配置加分）", () => {
    const novice = profileWith({}, 0.1);
    const r = recommend(plugins, novice, { stage: "novice", limit: 10 });
    expect(r.length).toBeGreaterThan(0);
    // 最高分插件应该在前
    const scores = r.map((x) => x.plugin.score.total);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    // 理由已精简：不再有配置类文案，时间类理由允许为空
    for (const x of r) {
      for (const reason of x.reasons) {
        expect(reason).not.toMatch(/高分|开箱即用|无需额外配置|实用分/);
      }
    }
  });

  it("老手模式：画像标签相关优先", () => {
    const vet = profileWith({ 飞书: 1, 文档管理: 1, 办公效率: 0.8 });
    const r = recommend(plugins, vet, { stage: "veteran", limit: 10 });
    expect(r.length).toBeGreaterThan(0);
    // 飞书类插件应该在推荐里（relevance > 0）
    const feishuHits = r.filter(
      (x) => x.plugin.tags.includes("飞书") && x.relevance > 0,
    );
    expect(feishuHits.length).toBeGreaterThan(0);
    // 理由已精简：配置类文案全部移除，时间类允许为空
    for (const x of r) {
      for (const reason of x.reasons) {
        expect(reason).not.toMatch(/高分|开箱即用|无需额外配置|实用分|与你关注/);
      }
    }
  });

  it("老手模式：MMR 多样性（避免同质连排）", () => {
    // 极端画像：全部权重在"办公效率"（覆盖多个插件）
    const vet = profileWith({ 办公效率: 1 });
    const r = recommend(plugins, vet, { stage: "veteran", limit: 8 });
    const tagSets = r.map((x) => new Set(x.plugin.tags));
    // 相邻推荐不应全部标签相同
    for (let i = 1; i < tagSets.length; i++) {
      const shared = [...tagSets[i]].filter((t) => tagSets[i - 1].has(t)).length;
      expect(shared).toBeLessThan(2); // 允许少量共享，但不应完全同质
    }
  });

  it("排除已装", () => {
    const vet = profileWith({ 飞书: 1 });
    const r = recommend(plugins, vet, {
      stage: "veteran",
      excludeIds: ["feishu/feishu-doc", "feishu/feishu-drive"],
      limit: 20,
    });
    expect(r.some((x) => x.plugin.id === "feishu/feishu-doc")).toBe(false);
    expect(r.some((x) => x.plugin.id === "feishu/feishu-drive")).toBe(false);
  });

  it("场景推荐：会话标签命中置顶", () => {
    const vet = profileWith({}, 0.9);
    const r = recommend(plugins, vet, {
      stage: "veteran",
      sceneTags: ["爬虫", "数据采集"],
      limit: 20,
    });
    expect(r.length).toBeGreaterThan(0);
    // 场景命中项存在且 origin 为 scene
    const scene = r.find((x) => x.origin === "scene");
    expect(scene).toBeTruthy();
    expect(scene!.plugin.id).toBe("acme/web-scraper");
    // 场景项在列表头部
    expect(r[0].origin).toBe("scene");
  });

  it("findSceneMatches 按命中数排序", () => {
    const m = findSceneMatches(plugins, ["办公效率", "文档管理"], new Date());
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].hitTags.length).toBeGreaterThanOrEqual(m[1]?.hitTags.length ?? 0);
  });

  it("精选兜底：curated 插件进入推荐", () => {
    const novice = profileWith({}, 0);
    const r = recommend(plugins, novice, { stage: "novice", limit: 20 });
    expect(r.some((x) => x.plugin.curated)).toBe(true);
  });

  it("完整流程：updateProfile → recommend", () => {
    const profile = updateProfile(null, plugins, {
      quizTags: ["飞书", "文档管理"],
    });
    const r = recommend(plugins, profile, { limit: 10 });
    expect(r.length).toBeGreaterThan(0);
  });
});
