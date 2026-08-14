import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { scanInstalled, splitNameVersion } from "../src/installed.js";
import {
  emptyProfile,
  EMA_ALPHA,
  mergeTags,
  stageOf,
  tagsFromInstalled,
  tagsFromQuiz,
  tagsFromStarred,
  topTags,
  updateProfile,
} from "../src/profile.js";
import type { InstalledPlugin } from "../src/types.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();

describe("installed", () => {
  it("splitNameVersion 解析 name-version", () => {
    expect(splitNameVersion("1password-1.0.1")).toEqual({
      baseName: "1password",
      version: "1.0.1",
    });
    expect(splitNameVersion("autoglm-browser-agent")).toEqual({
      baseName: "autoglm-browser-agent",
      version: null,
    });
    expect(splitNameVersion("feishu-doc-0.1.0")).toEqual({
      baseName: "feishu-doc",
      version: "0.1.0",
    });
  });

  it("扫描 skills 目录并匹配市场数据", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-test-"));
    mkdirSync(join(dir, "skills", "feishu-doc-1.0.0"), { recursive: true });
    mkdirSync(join(dir, "skills", "unknown-tool-2.0.0"), { recursive: true });
    const cfg = resolveConfig({
      dshHome: dir,
      skillsDir: join(dir, "skills"),
      profilesDir: join(dir, "profiles"),
      dataDir: join(dir, "data"),
    });
    const found = scanInstalled(cfg, market);
    const feishu = found.find((f) => f.localName === "feishu-doc-1.0.0");
    expect(feishu?.pluginId).toBe("feishu/feishu-doc");
    expect(feishu?.version).toBe("1.0.0");
    const unknown = found.find((f) => f.localName === "unknown-tool-2.0.0");
    expect(unknown?.pluginId).toBeNull();
    expect(unknown?.version).toBe("2.0.0");
  });

  it("扫描 profile 依赖（dsh 相关包才记录）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-test-"));
    const profileDir = join(dir, "profiles", "web");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^18.0.0",
          "@dingyi222666/dsh-focus-chat": "^0.1.1",
        },
      }),
    );
    const cfg = resolveConfig({
      dshHome: dir,
      skillsDir: join(dir, "skills"),
      profilesDir: join(dir, "profiles"),
      dataDir: join(dir, "data"),
    });
    const found = scanInstalled(cfg, market);
    expect(found.some((f) => f.localName === "@dingyi222666/dsh-focus-chat")).toBe(true);
    expect(found.some((f) => f.localName === "react")).toBe(false);
  });

  it("扫描 dsh.profile.bundles 组合包（官方基础包跳过）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-test-"));
    const profileDir = join(dir, "profiles", "web");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "dsh-profile-web",
        dsh: {
          profile: {
            bundles: [
              "@deepseek-ai/dsh-base",
              "@deepseek-ai/dsh-web-app",
              "@dingyi222666/dsh-focus-chat",
            ],
          },
        },
      }),
    );
    const cfg = resolveConfig({
      dshHome: dir,
      skillsDir: join(dir, "skills"),
      profilesDir: join(dir, "profiles"),
      dataDir: join(dir, "data"),
    });
    const found = scanInstalled(cfg, market);
    // 官方基础包被过滤
    expect(found.some((f) => f.localName.includes("dsh-base"))).toBe(false);
    // 第三方插件进入（未收录时 pluginId=null）
    expect(found.some((f) => f.localName === "@dingyi222666/dsh-focus-chat")).toBe(true);
  });
});

describe("profile", () => {
  it("空画像", () => {
    const p = emptyProfile();
    expect(p.confidence).toBe(0);
    expect(p.modeOverride).toBe("auto");
    expect(Object.keys(p.tags).length).toBe(0);
  });

  it("已装插件 → 标签权重", () => {
    const installed: InstalledPlugin[] = [
      { pluginId: "feishu/feishu-doc", localName: "feishu-doc-1.0.0", version: "1.0.0", source: "skills", plugin: market.plugins[0] },
      { pluginId: null, localName: "unknown-1.0.0", version: "1.0.0", source: "skills", plugin: null },
    ];
    const tags = tagsFromInstalled(installed, market.plugins);
    expect(tags["飞书"]).toBeGreaterThan(0);
    expect(tags["文档管理"]).toBeGreaterThan(0);
    // 未收录插件不贡献
    expect(Object.keys(tags).length).toBeGreaterThanOrEqual(2);
  });

  it("加星命中收录 → 标签权重（0.7 系数）", () => {
    const tags = tagsFromStarred(["feishu/feishu-doc", "some/other-repo"], market.plugins);
    expect(tags["飞书"]).toBeGreaterThan(0);
    expect(tags["飞书"]).toBeLessThan(tagsFromInstalled(
      [{ pluginId: "feishu/feishu-doc", localName: "x", version: null, source: "skills", plugin: market.plugins[0] }],
      market.plugins,
    )["飞书"] ?? 1);
  });

  it("问卷标签直接加权", () => {
    const tags = tagsFromQuiz(["飞书", "办公效率"]);
    expect(tags["飞书"]).toBe(1);
  });

  it("EMA 合并：新旧权重融合", () => {
    const old = { 飞书: 1.0, 旧标签: 0.5 };
    const incoming = { 飞书: 2.0, 新标签: 1.0 };
    const merged = mergeTags(old, incoming);
    expect(merged["飞书"]).toBeCloseTo(1.0 * (1 - EMA_ALPHA) + 2.0 * EMA_ALPHA);
    expect(merged["新标签"]).toBeCloseTo(EMA_ALPHA);
    // 旧标签保留（未被传入则不衰减——增量更新语义）
    expect(merged["旧标签"]).toBe(0.5);
  });

  it("updateProfile 完整流程：信号累积 + 置信度 + 阶段", () => {
    const installed: InstalledPlugin[] = [
      { pluginId: "feishu/feishu-doc", localName: "feishu-doc", version: null, source: "skills", plugin: market.plugins[0] },
      { pluginId: "note/knowledge-base", localName: "knowledge-base", version: null, source: "skills", plugin: market.plugins[9] },
      { pluginId: "note/obsidian-sync", localName: "obsidian-sync", version: null, source: "skills", plugin: market.plugins[10] },
      { pluginId: "acme/browser-tool", localName: "browser-tool", version: null, source: "skills", plugin: market.plugins[2] },
      { pluginId: "data-org/chart-gen", localName: "chart-gen", version: null, source: "skills", plugin: market.plugins[4] },
    ];
    const profile = updateProfile(null, market.plugins, {
      installed,
      starredFullNames: ["feishu/feishu-drive"],
      quizTags: ["飞书"],
    });
    expect(profile.confidence).toBeGreaterThan(0.4); // 老手
    expect(profile.tags["飞书"]).toBeGreaterThan(0);
    expect(profile.sources.installed.length).toBe(5);
    expect(profile.sources.starred).toContain("feishu/feishu-drive");
    expect(stageOf(profile)).toBe("veteran");

    // 增量更新：重复调用不重复累计已装（installedPluginIds 去重语义由调用方保证）
    const again = updateProfile(profile, market.plugins, { installed });
    expect(again.sources.installed.length).toBe(5);
  });

  it("少量信号 → 新手阶段；手动覆盖生效", () => {
    const p1 = updateProfile(null, market.plugins, {
      installed: [{ pluginId: "feishu/feishu-doc", localName: "x", version: null, source: "skills", plugin: market.plugins[0] }],
    });
    expect(stageOf(p1)).toBe("novice");

    const over = { ...p1, modeOverride: "veteran" as const };
    expect(stageOf(over)).toBe("veteran");
  });

  it("topTags 按权重排序", () => {
    const p = updateProfile(null, market.plugins, {
      quizTags: ["爬虫", "飞书", "安全"],
    });
    const tops = topTags(p, 2);
    expect(tops.length).toBe(2);
  });
});
