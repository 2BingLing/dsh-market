import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { scanInstalled, matchMarketPlugin } from "../src/installed.js";
import type { DshPlugin, MarketData } from "@dsh-market/schema";

/** 构造一个 str库条目（缩略，够 scanInstalled 用即可） */
function plugin(partial: { id: string; name: string; fullName?: string }): DshPlugin {
  return {
    id: partial.id,
    type: "cordis-plugin",
    name: partial.name,
    owner: partial.id.split("/")[0] ?? "o",
    repo: partial.name,
    fullName: partial.fullName ?? partial.id,
    stars: 1,
    forks: 0,
    openIssues: 0,
    language: null,
    description: `${partial.id} desc`,
    descriptionZh: null,
    tags: [],
    curated: false,
    homepage: null,
    license: null,
    topics: [],
    pushedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readmeSummary: null,
    install: { method: "pnpm-profile", needsConfig: false },
    score: {
      total: 50,
      breakdown: { maintain: 50, practical: 50, popularity: 50, ease: 50, signal: 50 },
      confidence: 0.5,
      explanation: "",
    },
    sources: ["topic"],
    lastCheckedAt: new Date().toISOString(),
  };
}

const scopedPlugin = plugin({
  id: "nanmicoder/dsh-agent-teams",
  name: "dsh-agent-teams",
});
const plainPlugin = plugin({ id: "acme/plain-dsh-tool", name: "plain-dsh-tool" });

function makeMarket(): MarketData {
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), plugins: [scopedPlugin, plainPlugin] };
}

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-installed-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

function setupProfile(cfg: ReturnType<typeof makeCfg>, pkg: object) {
  const web = join(cfg.profilesDir, "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, "package.json"), JSON.stringify(pkg), "utf8");
}

describe("matchMarketPlugin（issue #56 scoped 归一化）", () => {
  const byName = new Map(
    [scopedPlugin, plainPlugin].map((p) => [p.name.toLowerCase(), p] as const),
  );
  const byFull = new Map(
    [scopedPlugin, plainPlugin].map((p) => [p.fullName.toLowerCase(), p] as const),
  );

  it("scoped 包名 @scope/pkg → pkg 命中仓库名 name", () => {
    const dep = "@nanmicoder/dsh-agent-teams";
    expect(matchMarketPlugin(dep, byName, byFull)?.id).toBe("nanmicoder/dsh-agent-teams");
  });

  it("scoped 包名 → scope/pkg 命中 owner/repo（owner 与 scope 不同名时走全名）", () => {
    const p = plugin({ id: "ownerorg/whatever-dsh-tool", name: "whatever-dsh-tool" });
    const bN = new Map([[p.name.toLowerCase(), p] as const]);
    // 仓库名不匹配（name 是别的）时，scope/repo 全名兜底
    expect(matchMarketPlugin("@somescope/other-thing", bN, new Map([[p.fullName.toLowerCase(), p] as const]))).toBeNull();
    const byFull2 = new Map([[`scope-x/whatever-dsh-tool`, p] as const]);
    expect(matchMarketPlugin("@scope-x/whatever-dsh-tool", new Map(), byFull2)?.id).toBe("ownerorg/whatever-dsh-tool");
  });

  it("非 scoped 原名精确命中", () => {
    expect(matchMarketPlugin("plain-dsh-tool", byName, byFull)?.id).toBe("acme/plain-dsh-tool");
    expect(matchMarketPlugin("acme/plain-dsh-tool", byName, byFull)?.id).toBe("acme/plain-dsh-tool");
  });

  it("完全不匹配 → null", () => {
    expect(matchMarketPlugin("@other/unknown-thing", byName, byFull)).toBeNull();
  });
});

describe("scanInstalled · scoped 依赖（issue #56 回归）", () => {
  it("dependencies 里 scoped 包不再落「未收录」（pluginId 命中市场）", () => {
    const cfg = makeCfg();
    setupProfile(cfg, {
      name: "web-profile",
      version: "1.0.0",
      dependencies: { "@nanmicoder/dsh-agent-teams": "^0.1.8" },
    });
    const found = scanInstalled(cfg, makeMarket()).filter((i) => i.source === "profile");
    const scoped = found.find((i) => i.pluginId === "nanmicoder/dsh-agent-teams");
    expect(scoped).toBeTruthy();
    expect(scoped!.pluginId).toBe("nanmicoder/dsh-agent-teams");
    expect(scoped!.localName).toBe("@nanmicoder/dsh-agent-teams");
  });

  it("dsh.profile.bundles 里 scoped 包同样命中", () => {
    const cfg = makeCfg();
    setupProfile(cfg, {
      name: "web-profile",
      version: "1.0.0",
      dsh: { profile: { bundles: ["@nanmicoder/dsh-agent-teams"] } },
    });
    const found = scanInstalled(cfg, makeMarket()).filter((i) => i.source === "profile");
    expect(found.some((i) => i.pluginId === "nanmicoder/dsh-agent-teams")).toBe(true);
  });

  it("普通无 scope 依赖不受影响（仍可命中）", () => {
    const cfg = makeCfg();
    setupProfile(cfg, {
      name: "web-profile",
      version: "1.0.0",
      dependencies: { "plain-dsh-tool": "^1.0.0" },
    });
    const found = scanInstalled(cfg, makeMarket()).filter((i) => i.source === "profile");
    expect(found.some((i) => i.pluginId === "acme/plain-dsh-tool")).toBe(true);
  });
});
