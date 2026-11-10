import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { verifyActivation } from "../src/verify.js";

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-verify-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

/** 构造一个 cordis 已装场景 */
function setupCordis(
  cfg: ReturnType<typeof makeCfg>,
  name: string,
  opts: {
    inDeps?: boolean;
    inBundles?: boolean;
    installed?: boolean;
    dshKind?: "bundle" | "client" | "none" | "absent" | "legacyClient";
    patchApplied?: boolean;
  } = {},
) {
  const {
    inDeps = true,
    inBundles = false,
    installed = true,
    dshKind = "bundle",
    patchApplied = false,
  } = opts;
  const web = join(cfg.profilesDir, "web");
  mkdirSync(web, { recursive: true });
  const pkg: Record<string, unknown> = { name: "web-profile", version: "1.0.0" };
  if (inDeps) pkg.dependencies = { [name]: "^1.0.0" };
  if (inBundles) pkg.dsh = { profile: { bundles: [name] } };
  writeFileSync(join(web, "package.json"), JSON.stringify(pkg), "utf8");

  if (installed) {
    const nm = join(web, "node_modules", ...(name.startsWith("@") ? name.split("/") : [name]));
    mkdirSync(nm, { recursive: true });
    const ipkg: Record<string, unknown> = { name, version: "1.2.3", main: "index.js" };
    if (dshKind === "bundle") ipkg.dsh = { bundle: { patch: "./cordis.patch.yml" } };
    if (dshKind === "client") ipkg.dsh = { client: { platform: "web" } };
    // 旧版社区写法：顶层 dshClient（DSH 的 parseDshClient 只读 pkg.dsh.client，从不读它）
    if (dshKind === "legacyClient") ipkg.dshClient = { platform: "web", inject: [] };
    writeFileSync(join(nm, "package.json"), JSON.stringify(ipkg), "utf8");
  }

  if (patchApplied) {
    writeFileSync(
      join(web, "cordis.patch.yml"),
      `- insert:\n    - id: ${name}\n      name: ${name}\n`,
      "utf8",
    );
  }
}

describe("verifyActivation · cordis 型", () => {
  it("live：已入 bundles 且 patch 已应用", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-foo", { inBundles: true, dshKind: "bundle", patchApplied: true });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-foo" });
    expect(r.state).toBe("live");
    expect(r.inBundles).toBe(true);
    expect(r.hasBundle).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("restart：已入 bundles + 声明 dsh.bundle，但 patch 未应用", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-foo", { inBundles: true, dshKind: "bundle", patchApplied: false });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-foo" });
    expect(r.state).toBe("restart");
  });

  it("restart：纯客户端插件（dsh.client，无 bundle）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-client-only", { inBundles: false, dshKind: "client" });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-client-only" });
    expect(r.state).toBe("restart");
  });

  it("inert：声明 dsh.bundle 但未进入 dsh.profile.bundles（真值）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-orphan", { inDeps: true, inBundles: false, dshKind: "bundle" });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-orphan" });
    expect(r.state).toBe("inert");
    expect(r.inBundles).toBe(false);
  });

  it("inert：普通依赖（无 dsh.bundle / dsh.client）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "lodash", { inDeps: true, inBundles: false, dshKind: "none" });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "lodash" });
    expect(r.state).toBe("inert");
  });

  it("inert：只有顶层 dshClient 字段 → 不得判成 restart（DSH 只读 dsh.client）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-legacy-client", { inDeps: true, inBundles: false, dshKind: "legacyClient" });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-legacy-client" });
    expect(r.state).toBe("inert");
    expect(r.hasClient).toBe(false);
    expect(r.reasons.join(" ")).toContain("dshClient");
  });

  it("broken：依赖未写入（安装未生效）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-foo", { inDeps: false, inBundles: false, installed: true });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-foo" });
    expect(r.state).toBe("broken");
  });

  it("broken：node_modules 缺失（被回滚/占用）", () => {
    const cfg = makeCfg();
    setupCordis(cfg, "dsh-foo", { inDeps: true, inBundles: true, installed: false });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "dsh-foo" });
    expect(r.state).toBe("broken");
  });

  it("broken：profile 目录不存在", () => {
    const cfg = makeCfg();
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "nope", name: "dsh-foo" });
    expect(r.state).toBe("broken");
  });
});

describe("verifyActivation · skill 型", () => {
  it("live：目录存在", () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.skillsDir, "web-scraper"), { recursive: true });
    const r = verifyActivation(cfg, { type: "skill", name: "web-scraper" });
    expect(r.state).toBe("live");
  });

  it("broken：目录缺失", () => {
    const cfg = makeCfg();
    const r = verifyActivation(cfg, { type: "skill", name: "web-scraper" });
    expect(r.state).toBe("broken");
  });
});

describe("#365 · 验证误报修复", () => {
  /** 构造「市场短名 ≠ profile 依赖键（带 scope）」场景：@dsh-market/plugin vs plugin */
  function setupScoped(cfg: ReturnType<typeof makeCfg>, opts: { inBundles?: boolean; oldInstall?: boolean } = {}) {
    const { inBundles = true, oldInstall = true } = opts;
    const web = join(cfg.profilesDir, "web");
    mkdirSync(web, { recursive: true });
    const pkg: Record<string, unknown> = {
      name: "web-profile",
      version: "1.0.0",
      dependencies: { "@dsh-market/plugin": "^0.4.15" },
    };
    if (inBundles) pkg.dsh = { profile: { bundles: ["@dsh-market/plugin"] } };
    writeFileSync(join(web, "package.json"), JSON.stringify(pkg), "utf8");
    const nm = join(web, "node_modules", "@dsh-market", "plugin");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "package.json"),
      JSON.stringify({ name: "@dsh-market/plugin", version: "0.4.19", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
      "utf8",
    );
    if (oldInstall) {
      // 安装早于本次启动 → 已加载
      const past = new Date(Date.now() - process.uptime() * 1000 - 60_000);
      utimesSync(join(nm, "package.json"), past, past);
    }
  }

  it("短名 vs 带 scope 依赖键：不再误报 broken", () => {
    const cfg = makeCfg();
    setupScoped(cfg, { inBundles: false });
    // name=plugin（市场短名），依赖键是 @dsh-market/plugin——旧逻辑 `!("plugin" in deps)` 恒 broken
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "plugin" });
    expect(r.state).not.toBe("broken");
  });

  it("短名 + bundles + 安装早于本次启动 → live（此前恒 restart）", () => {
    const cfg = makeCfg();
    setupScoped(cfg, { inBundles: true, oldInstall: true });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "plugin" });
    expect(r.state).toBe("live");
    expect(r.reasons.join(" ")).toContain("早于本次启动");
  });

  it("短名 + bundles 但本次会话刚安装 → restart（正确语义）", () => {
    const cfg = makeCfg();
    setupScoped(cfg, { inBundles: true, oldInstall: false });
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "plugin" });
    expect(r.state).toBe("restart");
  });

  it("短名命中真实依赖键读 node_modules（@scope/pkg 存在）", () => {
    const cfg = makeCfg();
    setupScoped(cfg, { inBundles: false });
    // 若用短名直接读 node_modules/plugin 会 miss → broken；命中键后应往下走
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "plugin" });
    // dsh.bundle 声明存在但未进 bundles → inert（而非 broken）
    expect(r.state).toBe("inert");
    expect(r.hasBundle).toBe(true);
  });

  it("技能目录兜底：索引误标 cordis-plugin 的技能不再误报 broken", () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.skillsDir, "huashu-design"), { recursive: true });
    // type=cordis-plugin（索引标注错误），但技能目录存在 → 按技能验证
    const r = verifyActivation(cfg, { type: "cordis-plugin", name: "huashu-design" });
    expect(r.state).toBe("live");
    expect(r.reasons.join(" ")).toContain("技能已安装于");
  });

  it("对照：真未安装的包仍报 broken", () => {
    const cfg = makeCfg();
    const r = verifyActivation(cfg, { type: "cordis-plugin", profile: "web", name: "no-such-plugin-xyz" });
    expect(r.state).toBe("broken");
  });
});
