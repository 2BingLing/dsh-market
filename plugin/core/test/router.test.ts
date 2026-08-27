import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DshPlugin } from "@dsh-market/schema";
import { resolveConfig } from "../src/config.js";
import { deriveSmokeCommands, isInstalled, routeInstall } from "../src/router.js";
import { envFingerprint, readRecipe, writeRecipe } from "../src/recipe.js";
import type { CommandRunner } from "../src/types.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();
const skillPlugin = market.plugins.find((p) => p.type === "skill" && p.id === "acme/web-scraper")!;
const cordisPlugin = market.plugins.find(
  (p) => p.type === "cordis-plugin" && p.id === "feishu/feishu-doc",
)!;

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-router-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

function runnerMock(opts?: { fail?: boolean; failSmoke?: boolean }): CommandRunner {
  return {
    run: vi.fn(async (command: string) => {
      // 冒烟命令（node -e existsSync/dependencies 检查）单独可注入失败
      if (command.includes("existsSync")) {
        return opts?.failSmoke
          ? { exitCode: 1, stdout: "", stderr: "smoke failed" }
          : { exitCode: 0, stdout: "ok", stderr: "" };
      }
      if (opts?.fail) return { exitCode: 1, stdout: "", stderr: "simulated failure" };
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }),
  };
}

const withCommands = (plugin: DshPlugin, commands: string[]): DshPlugin => ({
  ...plugin,
  install: { ...plugin.install, commands },
});

describe("routeInstall T0 路由", () => {
  it("已装 → mode=already，零命令执行", async () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.skillsDir, "web-scraper-latest"), { recursive: true });
    const runner = runnerMock();
    const r = await routeInstall(cfg, skillPlugin, { profile: "web", runner });
    expect(r.mode).toBe("already");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("解析命令命中 → mode=parsed，写回配方", async () => {
    const cfg = makeCfg();
    const commands = [
      "git clone --depth 1 https://github.com/acme/web-scraper.git /tmp/x",
    ];
    const plugin = withCommands(skillPlugin, commands);
    const r = await routeInstall(cfg, plugin, { profile: "web", runner: runnerMock() });
    expect(r.mode).toBe("parsed");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    const recipe = readRecipe(cfg, plugin.id);
    expect(recipe?.learnedFrom).toBe("parsed");
    expect(recipe?.commands).toEqual(commands);
  });

  it("配方命中优先 → mode=recipe，执行配方命令", async () => {
    const cfg = makeCfg();
    writeRecipe(cfg, {
      pluginId: cordisPlugin.id,
      version: null,
      envFingerprint: envFingerprint(),
      type: "cordis-plugin",
      commands: ["dsh plugin --profile web add feishu-doc"],
      smoke: ["echo ok"],
      learnedFrom: "parsed",
      verifiedAt: new Date().toISOString(),
      lastSmoke: "pass",
    });
    const runner = runnerMock();
    const r = await routeInstall(cfg, cordisPlugin, { profile: "web", runner });
    expect(r.mode).toBe("recipe");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    expect(runner.run).toHaveBeenCalledWith(expect.stringContaining("feishu-doc"), expect.anything());
  });

  it("无解析命令 → mode=ai，needAi=true", async () => {
    const cfg = makeCfg();
    const r = await routeInstall(cfg, skillPlugin, { profile: "web", runner: runnerMock() });
    expect(r.mode).toBe("ai");
    expect(r.needAi).toBe(true);
  });

  it("解析命令失败 → ok=false，needAi 升级并附原因", async () => {
    const cfg = makeCfg();
    const plugin = withCommands(skillPlugin, ["echo boom"]);
    const r = await routeInstall(cfg, plugin, { profile: "web", runner: runnerMock({ fail: true }) });
    expect(r.mode).toBe("parsed");
    expect(r.ok).toBe(false);
    expect(r.needAi).toBe(true);
    expect(r.reason).toContain("安装失败");
  });

  it("冒烟失败 → 不写配方，needAi 升级", async () => {
    const cfg = makeCfg();
    const plugin = withCommands(skillPlugin, ["git clone --depth 1 https://github.com/acme/web-scraper.git /tmp/x"]);
    const r = await routeInstall(cfg, plugin, { profile: "web", runner: runnerMock({ failSmoke: true }) });
    expect(r.ok).toBe(true);
    expect(r.result?.smokeFailed).toBe(true);
    expect(r.needAi).toBe(true);
    expect(readRecipe(cfg, plugin.id)).toBeNull();
  });

  it("deriveSmokeCommands：skill → 目录+SKILL.md；cordis → package.json 依赖", () => {
    const cfg = makeCfg();
    const skillSmoke = deriveSmokeCommands(cfg, skillPlugin, "web");
    expect(skillSmoke).toHaveLength(2);
    expect(skillSmoke[0]).toContain("existsSync");
    expect(skillSmoke[1]).toContain("SKILL.md");
    const cordisSmoke = deriveSmokeCommands(cfg, cordisPlugin, "web");
    expect(cordisSmoke).toHaveLength(2);
    expect(cordisSmoke[1]).toContain("dependencies");
  });

  it("isInstalled：cordis 依赖判断", async () => {
    const cfg = makeCfg();
    expect(isInstalled(cfg, cordisPlugin, "web")).toBe(false);
    const profileDir = join(cfg.profilesDir, "web");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "package.json"),
      JSON.stringify({ dependencies: { "feishu-doc": "1.0.0" } }),
      "utf8",
    );
    expect(isInstalled(cfg, cordisPlugin, "web")).toBe(true);
  });
});