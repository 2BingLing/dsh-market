/**
 * 中文意图词典测试：查询扩展 + 搜索召回集成（§5.3 "搜'记事本'要能命中 dsh-notes" 判据）
 * 2026-09-29 起 terms 支持 `#` 词边界标记（词典卫生：防 "ai" 子串吃掉 email/main）。
 */
import { describe, expect, it } from "vitest";
import { expandZhQuery, isTokenTerm, rawTerm, tokenInText, ZH_INTENTS } from "../src/zh-intent.js";
import { search } from "../src/search.js";
import { makePlugin } from "./fixture.js";

describe("expandZhQuery", () => {
  it("「记事本」扩展出 #notes 等召回词（memo 已在 09-26 校准收掉）", () => {
    const r = expandZhQuery("我想要个记事本插件");
    expect(r.intents).toContain("记事本");
    const terms = r.terms;
    expect(terms).toContain("#notes");
    expect(terms).not.toContain("memo");
  });

  it("多意图同时命中", () => {
    const r = expandZhQuery("截图并翻译");
    expect(r.intents).toContain("截图");
    expect(r.intents).toContain("翻译");
  });

  it("不命中任何意图时返回空扩展（搜索行为不变）", () => {
    const r = expandZhQuery("dsh-notes");
    expect(r.intents).toHaveLength(0);
    expect(r.terms).toHaveLength(0);
  });

  it("空查询安全", () => {
    expect(expandZhQuery("").terms).toHaveLength(0);
    expect(expandZhQuery("   ").intents).toHaveLength(0);
  });

  it("扩展词剔除会被主查询覆盖的词（查询含'笔记'时不再扩展'笔记'）", () => {
    const r = expandZhQuery("笔记");
    // "笔记" 是主查询的子串 → 不应出现在扩展词里（避免重复扫描）
    expect(r.terms).not.toContain("笔记");
    // 但英文召回词仍在（# 标记形态）
    expect(r.terms).toContain("#notes");
  });

  it("词典卫生：所有意图的 words/terms 非空且无重复词条目", () => {
    for (const it of ZH_INTENTS) {
      expect(it.words.length, it.key).toBeGreaterThan(0);
      expect(it.terms.length, it.key).toBeGreaterThan(0);
      const uniq = new Set(it.terms.map((t) => t.toLowerCase()));
      expect(uniq.size, it.key).toBe(it.terms.length);
    }
  });

  it("词典卫生：# 标记词与裸词不重复（同词两种形态只留一种）", () => {
    for (const it of ZH_INTENTS) {
      const raws = new Set(it.terms.map((t) => rawTerm(t).toLowerCase()));
      expect(raws.size, it.key).toBe(it.terms.length);
    }
  });
});

describe("词边界（token）匹配", () => {
  it("isTokenTerm / rawTerm 识别 # 前缀", () => {
    expect(isTokenTerm("#ai")).toBe(true);
    expect(isTokenTerm("llm")).toBe(false);
    expect(rawTerm("#ai")).toBe("ai");
    expect(rawTerm("llm")).toBe("llm");
  });

  it("tokenInText：独立词命中，词内子串不命中", () => {
    // 命中：kebab 前缀 / 大写 / CJK 相邻 / 下划线
    expect(tokenInText("ai", "dsh-ai-notes")).toBe(true);
    expect(tokenInText("ai", "AI Chat")).toBe(true);
    expect(tokenInText("ai", "ai聊天助手")).toBe(true);
    expect(tokenInText("ai", "my_ai_tool")).toBe(true);
    // 不命中：email/main/pipeline 这类子串误报
    expect(tokenInText("ai", "dsh-email-helper")).toBe(false);
    expect(tokenInText("ai", "main-tool")).toBe(false);
    expect(tokenInText("ai", "article-pipeline")).toBe(false);
    // openai/chatgpt 是单个 token，"ai"/"gpt" 都不该子串命中
    expect(tokenInText("ai", "openai-bridge")).toBe(false);
    expect(tokenInText("gpt", "chatgpt-tools")).toBe(false);
  });
});

describe("search × 中文意图（召回层集成）", () => {
  // fixture 插件：中文名不与"记事本"相交，英文名 dsh-notes —— 字面不相交的典型场景
  const plugins = [
    makePlugin({ id: "alice/dsh-notes", name: "dsh-notes", descriptionZh: "快速记下灵感与待办" }),
    makePlugin({ id: "bob/dsh-weather", name: "dsh-weather", descriptionZh: "实时天气预报" }),
    makePlugin({ id: "carol/clip-tool", name: "clip-tool", descriptionZh: "剪贴板增强" }),
  ];

  it("判据用例：搜「记事本」命中 dsh-notes（旧逻辑召回为空）", () => {
    const r = search(plugins, "记事本");
    expect(r.map((x) => x.plugin.id)).toContain("alice/dsh-notes");
    expect(r[0].via).toContain("记事本");
  });

  it("主查询子串命中仍然优先于扩展命中", () => {
    // bob/dsh-weather 的名字含 weather（"天气"意图扩展词）——排前应靠标签精确命中；
    // 而"天气"本身也是主查询子串（descriptionZh 含"天气"）→ relevance 95 绝对优先
    const r = search(plugins, "天气");
    expect(r[0].plugin.id).toBe("bob/dsh-weather");
    expect(r[0].relevance).toBeGreaterThanOrEqual(90);
  });

  it("标签精确命中（tags 含扩展词）排在字段子串之前", () => {
    const tagged = [
      makePlugin({ id: "dave/notes-app", name: "some-app", descriptionZh: "完全无关的描述", tags: ["notes"] }),
      makePlugin({ id: "eve/notes-desc", name: "another-app", descriptionZh: "notes tool for daily" }),
    ];
    const r = search(tagged, "记事本");
    expect(r[0].plugin.id).toBe("dave/notes-app"); // 标签精确命中（score 0.15 → 85）
    expect(r[1].plugin.id).toBe("eve/notes-desc"); // 词边界命中 dsh-notes? 不——这里 name 是 another-app，
    // description 含独立词 notes → token 命中（score 0.3 → 70）
  });

  it("词边界召回词不命中子串误报（email 不再命中「AI大模型」）", () => {
    const aiPlugins = [
      makePlugin({ id: "f/ai-chat", name: "ai-chat", descriptionZh: "AI 聊天助手" }),
      makePlugin({ id: "g/email-tool", name: "email-tool", descriptionZh: "邮件收发工具" }),
    ];
    const r = search(aiPlugins, "大模型");
    expect(r.map((x) => x.plugin.id)).toContain("f/ai-chat");
    expect(r.map((x) => x.plugin.id)).not.toContain("g/email-tool");
  });

  it("无意图词的普通查询行为不变（不引入 via）", () => {
    const r = search(plugins, "clip");
    expect(r.map((x) => x.plugin.id)).toContain("carol/clip-tool");
    expect(r.find((x) => x.plugin.id === "carol/clip-tool")?.via).toBeUndefined();
  });
});
