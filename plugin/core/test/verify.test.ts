import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
    dshKind?: "bundle" | "client" | "none" | "absent";
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
