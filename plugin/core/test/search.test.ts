import { describe, expect, it } from "vitest";
import { search } from "../src/search.js";
import { aggregateTags, hotTags, matchesTags, tagMatchCount } from "../src/tags.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();
const plugins = market.plugins;

describe("search", () => {
  it("空查询返回全部并按分数排序", () => {
    const r = search(plugins, "", { limit: 5 });
    expect(r.length).toBe(5);
    expect(r[0].plugin.score.total).toBeGreaterThanOrEqual(r[1].plugin.score.total);
  });

  it("关键词命中 name/描述", () => {
    const r = search(plugins, "飞书");
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.every((x) => /飞书/.test(x.plugin.name + (x.plugin.descriptionZh ?? "")))).toBe(true);
  });

  it("英文关键词命中 name", () => {
    const r = search(plugins, "feishu");
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("子串兜底：命中 descriptionZh 中的词", () => {
    const r = search(plugins, "知识库");
    expect(r.map((x) => x.plugin.id)).toContain("note/knowledge-base");
    expect(r.map((x) => x.plugin.id)).toContain("note/obsidian-sync");
  });

  it("标签 AND 过滤", () => {
    const r = search(plugins, "", { tags: ["飞书"] });
    expect(r.every((x) => x.plugin.tags.includes("飞书"))).toBe(true);
    expect(r.length).toBe(2);
  });

  it("语义标签增强命中（tagHits 排序优先）", () => {
    const r = search(plugins, "", { semanticTags: ["文档管理"] });
    expect(r.length).toBeGreaterThan(0);
    // 命中语义标签的排前面
    expect(r[0].tagHits).toBeGreaterThan(0);
  });

  it("类型过滤", () => {
    const r = search(plugins, "", { type: "skill" });
    expect(r.every((x) => x.plugin.type === "skill")).toBe(true);
  });

  it("needsConfig 过滤", () => {
    const r = search(plugins, "", { noConfigOnly: true });
    expect(r.every((x) => !x.plugin.install.needsConfig)).toBe(true);
  });

  it("排除已装", () => {
    const r = search(plugins, "", { excludeIds: ["feishu/feishu-doc"] });
    expect(r.some((x) => x.plugin.id === "feishu/feishu-doc")).toBe(false);
  });

  it("newest 排序", () => {
    const r = search(plugins, "", { sortBy: "newest" });
    const times = r.map((x) => new Date(x.plugin.pushedAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });
});

describe("tags", () => {
  it("聚合中文标签并过滤宽泛标签", () => {
    const stats = aggregateTags(plugins);
    const names = stats.map((s) => s.tag);
    expect(names).toContain("飞书");
    expect(names).not.toContain("AI 增强"); // 宽泛标签被过滤
    expect(names).not.toContain("acp"); // 非中文被过滤
  });

  it("hotTags 返回前 N", () => {
    expect(hotTags(plugins, 3).length).toBe(3);
  });

  it("matchesTags AND 语义", () => {
    const p = plugins[0];
    expect(matchesTags(p, ["飞书"])).toBe(true);
    expect(matchesTags(p, ["飞书", "文档管理"])).toBe(true);
    expect(matchesTags(p, ["飞书", "爬虫"])).toBe(false);
  });

  it("tagMatchCount 计数", () => {
    expect(tagMatchCount(plugins[0], ["飞书", "爬虫"])).toBe(1);
  });
});
