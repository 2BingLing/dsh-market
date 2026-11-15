import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { scanInstalled, matchMarketPlugin } from "../src/installed.js";
import type { DshPlugin, MarketData } from "@dsh-market/schema";

/** 构造一个市场条目（缩略，够 scanInstalled 用即可） */
function plugin(partial: {
  id: string;
  name: string;
  fullName?: string;
  stars?: number;
  curated?: boolean;
  commands?: string[];
}): DshPlugin {
  return {
    id: partial.id,
    type: "cordis-plugin",
    name: partial.name,
    owner: partial.id.split("/")[0] ?? "o",
    repo: partial.name,
    fullName: partial.fullName ?? partial.id,
    stars: partial.stars ?? 1,
    forks: 0,
    openIssues: 0,
    language: null,
    description: `${partial.id} desc`,
    descriptionZh: null,
    tags: [],
    curated: partial.curated ?? false,
    homepage: null,
    license: null,
    topics: [],
    pushedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readmeSummary: null,
    install: {
      method: "pnpm-profile",
      needsConfig: false,
      ...(partial.commands ? { commands: partial.commands } : {}),
    },
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

describe("scanInstalled · skill 目录约定（issue #102 回归）", () => {
  it("<name> 目录与旧 <name>-latest 残留都能匹配市场条目", () => {
    const cfg = makeCfg();
    const skill = plugin({ id: "acme/web-scraper", name: "web-scraper" });
    const market: MarketData = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      plugins: [skill],
    };
    mkdirSync(join(cfg.skillsDir, "web-scraper"), { recursive: true });
    mkdirSync(join(cfg.skillsDir, "web-scraper-latest"), { recursive: true });
    const found = scanInstalled(cfg, market).filter((i) => i.source === "skills");
    expect(found.map((i) => i.localName).sort()).toEqual(["web-scraper", "web-scraper-latest"]);
    expect(found.find((i) => i.localName === "web-scraper")?.pluginId).toBe("acme/web-scraper");
    expect(found.find((i) => i.localName === "web-scraper-latest")?.pluginId).toBe("acme/web-scraper");
  });
});

describe("#288 无 dsh 前缀但已收录的插件不应漏判", () => {
  // 市场目录里有一条第三方 dsh-web-app（与官方包 @deepseek-ai/dsh-web-app 同名异主），
  // 用于复现 scoped fallback 的官方包泄漏陷阱
  const webAppClone = plugin({ id: "frankshi2024/dsh-web-app", name: "dsh-web-app" });
  const billion = plugin({ id: "ranxianglei/billion-context", name: "billion-context" });
  const modlens = plugin({ id: "yukitakasama/modlens", name: "modlens" });
  const market288: MarketData = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    plugins: [webAppClone, billion, modlens, scopedPlugin],
  };

  it("deps：无 dsh 前缀但市场收录（billion-context）→ 已装识别；普通包（react）仍跳过", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "billion-context": "^0.1.206", react: "^18.0.0" } });
    const r = scanInstalled(cfg, market288);
    const hit = r.find((x) => x.localName === "billion-context");
    expect(hit?.pluginId).toBe("ranxianglei/billion-context");
    expect(hit?.version).toBe("0.1.206");
    expect(r.find((x) => x.localName === "react")).toBeUndefined();
  });

  it("bundles：插件只在 bundles 里 → 识别；官方包经 scoped fallback 也不得泄漏", () => {
    const cfg = makeCfg();
    setupProfile(cfg, {
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-web-app", "billion-context"] } },
    });
    const r = scanInstalled(cfg, market288).filter((x) => x.source === "profile");
    expect(r.map((x) => x.localName)).toEqual(["billion-context"]);
    expect(r[0]?.pluginId).toBe("ranxianglei/billion-context");
    expect(r.find((x) => x.pluginId === "frankshi2024/dsh-web-app")).toBeUndefined();
  });

  it("scoped 无前缀：@liustack/modlens → 市场条目 yukitakasama/modlens（#288 另一处漏判）", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "@liustack/modlens": "3.27.2" } });
    const hit = scanInstalled(cfg, market288).find((x) => x.localName === "@liustack/modlens");
    expect(hit?.pluginId).toBe("yukitakasama/modlens");
    expect(hit?.version).toBe("3.27.2");
  });
});

describe("重名条目消歧（同名不同仓库）", () => {
  // 市场索引里 dsh-context 有两条同名条目：真实的 npm 包（bowenliang123，安装命令点名了
  // dsh-context）和一条 0 星重名仓库（qiangweiliu）。早先 byName 是单值 Map，后者会覆盖
  // 前者，「已装 dsh-context」于是被记到 0 星条目上，用户装的那张卡片仍显示「安装」。
  const realContext = plugin({
    id: "bowenliang123/dsh-context",
    name: "dsh-context",
    stars: 5104,
    commands: [
      "dsh plugin --profile web add dsh-context",
      "dsh plugin --profile web update dsh-context@latest",
    ],
  });
  const strayContext = plugin({ id: "qiangweiliu/dsh-context", name: "dsh-context", stars: 0 });

  function marketWith(plugins: DshPlugin[]): MarketData {
    return { schemaVersion: 2, generatedAt: new Date().toISOString(), plugins };
  }

  it("安装命令点名该包的条目优先（重名条目排在后面也不被覆盖）", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "dsh-context": "^0.84.1" } });
    const hit = scanInstalled(cfg, marketWith([realContext, strayContext])).find(
      (i) => i.localName === "dsh-context",
    );
    expect(hit?.pluginId).toBe("bowenliang123/dsh-context");
    expect(hit?.version).toBe("0.84.1");
  });

  it("结果不依赖索引顺序", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "dsh-context": "^0.84.1" } });
    const hit = scanInstalled(cfg, marketWith([strayContext, realContext])).find(
      (i) => i.localName === "dsh-context",
    );
    expect(hit?.pluginId).toBe("bowenliang123/dsh-context");
  });

  it("两条都没有安装命令时退到精选/热度，同样与索引顺序无关", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "dsh-context": "^0.84.1" } });
    const low = plugin({ id: "aaa/dsh-context", name: "dsh-context", stars: 3 });
    const high = plugin({ id: "zzz/dsh-context", name: "dsh-context", stars: 900 });
    expect(
      scanInstalled(cfg, marketWith([low, high])).find((i) => i.localName === "dsh-context")
        ?.pluginId,
    ).toBe("zzz/dsh-context");
    expect(
      scanInstalled(cfg, marketWith([high, low])).find((i) => i.localName === "dsh-context")
        ?.pluginId,
    ).toBe("zzz/dsh-context");
  });
});

describe("scoped 依赖不被同名裸包名的第三方仓库认领", () => {
  // @dsh-market/plugin 的包名末段是 "plugin"，市场里恰有一条名为 plugin 的仓库
  // dsh-remote/plugin（安装命令 add @dsh-remote/plugin）。旧实现按裸包名兜底会把它
  // 认成「已装」：已安装列表多一条错归属，dsh-remote/plugin 卡片还会被从发现页误排除。
  const remotePlugin = plugin({
    id: "dsh-remote/plugin",
    name: "plugin",
    stars: 4,
    commands: ["dsh plugin --profile web add @dsh-remote/plugin"],
  });
  const marketData: MarketData = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    plugins: [remotePlugin],
  };

  it("@dsh-market/plugin 不再被 dsh-remote/plugin 认领（pluginId=null）", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "@dsh-market/plugin": "^0.4.21" } });
    const hit = scanInstalled(cfg, marketData).find((i) => i.localName === "@dsh-market/plugin");
    expect(hit).toBeTruthy();
    expect(hit!.pluginId).toBeNull();
  });

  it("真正安装 @dsh-remote/plugin 时仍能匹配", () => {
    const cfg = makeCfg();
    setupProfile(cfg, { dependencies: { "@dsh-remote/plugin": "^0.1.0" } });
    const hit = scanInstalled(cfg, marketData).find((i) => i.localName === "@dsh-remote/plugin");
    expect(hit?.pluginId).toBe("dsh-remote/plugin");
  });
});
