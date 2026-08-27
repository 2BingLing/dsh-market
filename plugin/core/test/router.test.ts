import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DshPlugin } from "@dsh-market/schema";
import { resolveConfig } from "../src/config.js";
import { deriveSmokeCommands, expandHome, extractInstallPkgName, isInstalled, normalizeSkillCommands, routeInstall } from "../src/router.js";
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

function runnerMock(opts?: { fail?: boolean }): CommandRunner {
  return {
    run: vi.fn(async () => {
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

  it("解析命令命中 → mode=parsed，写回配方（skill clone 目标被规范化 + 结构化冒烟通过）", async () => {
    const cfg = makeCfg();
    const commands = [
      "git clone --depth 1 https://github.com/acme/web-scraper.git /tmp/x",
    ];
    const plugin = withCommands(skillPlugin, commands);
    // mock 模拟 clone 真实落地：执行 git clone 时创建 <name>-latest/SKILL.md（结构化冒烟据此通过）
    const dest = join(cfg.skillsDir, "web-scraper-latest");
    const runner: CommandRunner = {
      run: vi.fn(async (command: string) => {
        if (/git\s+clone/.test(command)) {
          mkdirSync(dest, { recursive: true });
          writeFileSync(join(dest, "SKILL.md"), "skill", "utf8");
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }),
    };
    const r = await routeInstall(cfg, plugin, { profile: "web", runner });
    expect(r.mode).toBe("parsed");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    const recipe = readRecipe(cfg, plugin.id);
    expect(recipe?.learnedFrom).toBe("parsed");
    // 目标已规范化：<skillsDir>/web-scraper-latest（与冒烟/卸载约定一致，不加引号同 installer 约定）
    const expected = [
      `git clone --depth 1 https://github.com/acme/web-scraper.git ${dest}`,
    ];
    expect(recipe?.commands).toEqual(expected);
    expect(recipe?.commands).not.toContain("/tmp/x");
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

  it("无解析命令 → builtin 兜底尝试，冒烟失败仍升级 AI", async () => {
    const cfg = makeCfg();
    // mock 不创建技能目录 → 内置 clone 后结构化冒烟失败 → needAi
    const r = await routeInstall(cfg, skillPlugin, { profile: "web", runner: runnerMock() });
    expect(r.mode).toBe("builtin");
    expect(r.needAi).toBe(true);
    expect(r.reason).toContain("内置安装");
  });

  it("无解析命令 cordis → builtin 兜底：dsh plugin add + deps 冒烟通过 → 配方", async () => {
    const cfg = makeCfg();
    const profileDir = join(cfg.profilesDir, "web");
    mkdirSync(profileDir, { recursive: true });
    // mock 模拟 dsh plugin add 真实落地：把依赖写进 profile package.json
    const runner: CommandRunner = {
      run: vi.fn(async (command: string) => {
        if (/dsh plugin/.test(command)) {
          writeFileSync(
            join(profileDir, "package.json"),
            JSON.stringify({ dependencies: { "feishu-doc": "1.0.0" } }),
            "utf8",
          );
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }),
    };
    const r = await routeInstall(cfg, cordisPlugin, { profile: "web", runner });
    expect(r.mode).toBe("builtin");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    // 配方 = 内置规范命令
    const recipe = readRecipe(cfg, cordisPlugin.id);
    expect(recipe?.commands).toEqual(["dsh plugin --profile web add feishu-doc"]);
  });

  it("无解析命令 skill → builtin 兜底：内置 clone + SKILL.md 冒烟通过 → 配方", async () => {
    const cfg = makeCfg();
    const dest = join(cfg.skillsDir, "web-scraper-latest");
    const runner: CommandRunner = {
      run: vi.fn(async (command: string) => {
        if (/git\s+clone/.test(command)) {
          mkdirSync(dest, { recursive: true });
          writeFileSync(join(dest, "SKILL.md"), "skill", "utf8");
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }),
    };
    const r = await routeInstall(cfg, skillPlugin, { profile: "web", runner });
    expect(r.mode).toBe("builtin");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    const recipe = readRecipe(cfg, skillPlugin.id);
    expect(recipe?.commands[0]).toContain("git clone");
    expect(recipe?.commands[0]).toContain("web-scraper-latest");
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

  it("冒烟失败（技能目录未落位）→ 不写配方，needAi 升级", async () => {
    const cfg = makeCfg();
    // 不创建技能目录 → 结构化冒烟（SKILL.md 存在）自然失败
    const plugin = withCommands(skillPlugin, ["git clone --depth 1 https://github.com/acme/web-scraper.git /tmp/x"]);
    const r = await routeInstall(cfg, plugin, { profile: "web", runner: runnerMock() });
    expect(r.ok).toBe(true);
    expect(r.result?.smokeFailed).toBe(true);
    expect(r.needAi).toBe(true);
    expect(readRecipe(cfg, plugin.id)).toBeNull();
  });

  it("deriveSmokeCommands：skill → SKILL.md 结构化检查；cordis → deps 结构化检查", () => {
    const cfg = makeCfg();
    const skillSmoke = deriveSmokeCommands(cfg, skillPlugin, "web");
    expect(skillSmoke).toHaveLength(1);
    expect(skillSmoke[0]).toMatchObject({
      type: "exists",
      path: join(cfg.skillsDir, "web-scraper-latest", "SKILL.md"),
    });
    const cordisSmoke = deriveSmokeCommands(cfg, cordisPlugin, "web");
    expect(cordisSmoke).toHaveLength(1);
    expect(cordisSmoke[0]).toMatchObject({ type: "deps", pkgName: "feishu-doc" });
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

  it("cordis 冒烟对账：解析命令包名优先（name 字段为 owner/repo 也能正确对账）", async () => {
    const cfg = makeCfg();
    // 真实数据形态：name 是 owner/repo，命令里才是真实包名
    const plugin: DshPlugin = {
      ...cordisPlugin,
      name: "saktawdi/dsh-ha-orchestrator",
      install: { ...cordisPlugin.install, commands: ["dsh plugin --profile web add dsh-ha-orchestrator"] },
    };
    const profileDir = join(cfg.profilesDir, "web");
    mkdirSync(profileDir, { recursive: true });
    const runner: CommandRunner = {
      run: vi.fn(async (command: string) => {
        if (/dsh plugin/.test(command)) {
          writeFileSync(
            join(profileDir, "package.json"),
            JSON.stringify({ dependencies: { "dsh-ha-orchestrator": "0.12.2" } }),
            "utf8",
          );
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }),
    };
    const r = await routeInstall(cfg, plugin, { profile: "web", runner });
    expect(r.mode).toBe("parsed");
    expect(r.ok).toBe(true);
    expect(r.needAi).toBe(false);
    const recipe = readRecipe(cfg, plugin.id);
    expect(recipe?.commands[0]).toContain("dsh-ha-orchestrator");
  });

  it("extractInstallPkgName：常见安装命令的真实包名提取", () => {
    expect(extractInstallPkgName("dsh plugin --profile web add dsh-ha-orchestrator")).toBe("dsh-ha-orchestrator");
    expect(extractInstallPkgName("dsh plugin --profile app add github:owner/repo-name")).toBe("repo-name");
    expect(extractInstallPkgName("pnpm add @scope/pkg")).toBe("@scope/pkg");
    expect(extractInstallPkgName("npm i some-tool -g")).toBe("some-tool");
    expect(extractInstallPkgName("git clone https://github.com/a/b.git x")).toBeNull();
    expect(extractInstallPkgName("echo hi")).toBeNull();
  });
});

describe("normalizeSkillCommands · skill 解析命令规范化", () => {
  it("~/.dsh/skills 等外部目标 → 重定向进 cfg.skillsDir/<name>-latest", () => {
    const cfg = makeCfg();
    const out = normalizeSkillCommands(cfg, skillPlugin, [
      "git clone --depth 1 https://github.com/acme/web-scraper.git ~/.dsh/skills/web-scraper",
    ]);
    const canonical = join(cfg.skillsDir, "web-scraper-latest");
    expect(out[0]).toContain(canonical);
    expect(out[0]).not.toContain("~/.dsh");
    expect(out[0]).not.toContain('"');
  });

  it("目标已是规范位置 → 原样交付", () => {
    const cfg = makeCfg();
    const canonical = join(cfg.skillsDir, "web-scraper-latest");
    const cmd = `git clone https://github.com/acme/web-scraper.git ${JSON.stringify(canonical)}`;
    expect(normalizeSkillCommands(cfg, skillPlugin, [cmd])).toEqual([cmd]);
  });

  it("非 clone / 多命令 / 带引号目标 → 原样交付（交冒烟→AI 兜底）", () => {
    const cfg = makeCfg();
    const multi = ["git clone https://x/y.git a", "cd a && npm i"];
    expect(normalizeSkillCommands(cfg, skillPlugin, multi)).toEqual(multi);
    const notClone = ["echo hi"];
    expect(normalizeSkillCommands(cfg, skillPlugin, notClone)).toEqual(notClone);
  });

  it("cordis 型不受影响", () => {
    const cfg = makeCfg();
    const cmd = ["dsh plugin --profile web add something"];
    expect(normalizeSkillCommands(cfg, cordisPlugin, cmd)).toEqual(cmd);
  });

  it("expandHome：~/ 与 ~ 展开", () => {
    expect(expandHome("~/.dsh/skills/x")).toBe(join(require("node:os").homedir(), ".dsh", "skills", "x"));
    expect(expandHome("~")).toBe(require("node:os").homedir());
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });
});