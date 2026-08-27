import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import {
  RECIPE_TTL_MS,
  envFingerprint,
  isRecipeFresh,
  listRecipes,
  readRecipe,
  writeRecipe,
} from "../src/recipe.js";
import type { Recipe } from "../src/recipe.js";

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-recipe-"));
  // 显式指定所有路径到临时目录，防止探测到真实用户目录
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

const base = (): Recipe => ({
  pluginId: "acme/web-scraper",
  version: null,
  envFingerprint: envFingerprint(),
  type: "skill",
  commands: ["echo hi"],
  smoke: ["echo ok"],
  learnedFrom: "parsed",
  verifiedAt: new Date().toISOString(),
  lastSmoke: "pass",
});

describe("recipe 配方缓存", () => {
  it("写读回环，落盘 dataDir/recipes/<id>.json", () => {
    const cfg = makeCfg();
    writeRecipe(cfg, base());
    expect(existsSync(join(cfg.dataDir, "recipes", "acme_web-scraper.json"))).toBe(true);
    const r = readRecipe(cfg, "acme/web-scraper");
    expect(r?.commands).toEqual(["echo hi"]);
    expect(r?.learnedFrom).toBe("parsed");
  });

  it("未命中 / 损坏 JSON 返回 null", () => {
    const cfg = makeCfg();
    expect(readRecipe(cfg, "nope/x")).toBeNull();
    writeRecipe(cfg, base());
    writeFileSync(join(cfg.dataDir, "recipes", "acme_web-scraper.json"), "{bad json", "utf8");
    expect(readRecipe(cfg, "acme/web-scraper")).toBeNull();
  });

  it("listRecipes 汇总全部配方（透明可审查）", () => {
    const cfg = makeCfg();
    writeRecipe(cfg, base());
    const list = listRecipes(cfg);
    expect(list).toHaveLength(1);
    expect(list[0]?.pluginId).toBe("acme/web-scraper");
    expect(list[0]?.lastSmoke).toBe("pass");
  });

  it("过期判定：超过 TTL 不再新鲜", () => {
    expect(isRecipeFresh(base())).toBe(true);
    const old = {
      ...base(),
      verifiedAt: new Date(Date.now() - RECIPE_TTL_MS - 1000).toISOString(),
    };
    expect(isRecipeFresh(old)).toBe(false);
  });

  it("envFingerprint 稳定且非空", () => {
    expect(envFingerprint()).toBe(envFingerprint());
    expect(envFingerprint().length).toBeGreaterThan(0);
  });
});