/**
 * #378 · detectActiveProfile 兜底：桌面端不设 DSH_PROFILE 环境变量，此前直接落
 * defaultProfile（"web"）——桌面端真实 profile（desktop）的 settings.json 被写成
 * web，已装校验 / resolveNpmRegistry 全部指向不存在的 profile 目录。
 * 新链路：env → profilesDir 唯一有效 profile（含 package.json 的目录）→ 默认。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, detectActiveProfile } from "../src/config.js";

function makeCfg(dir: string) {
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("#378 · detectActiveProfile 探测兜底", () => {
  it("env 优先级最高（不受扫描影响）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-prof-"));
    const cfg = makeCfg(dir);
    mkdirSync(join(cfg.profilesDir, "desktop"), { recursive: true });
    vi.stubEnv("DSH_PROFILE", "explicit");
    expect(detectActiveProfile(cfg)).toBe("explicit");
    rmSync(dir, { recursive: true, force: true });
  });

  it("唯一有效 profile 目录（含 package.json）→ 采用它", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-prof-"));
    const cfg = makeCfg(dir);
    mkdirSync(join(cfg.profilesDir, "desktop"), { recursive: true });
    writeFileSync(join(cfg.profilesDir, "desktop", "package.json"), "{}", "utf8");
    expect(detectActiveProfile(cfg)).toBe("desktop");
    rmSync(dir, { recursive: true, force: true });
  });

  it("多个有效 profile → 不乱猜，回默认", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-prof-"));
    const cfg = makeCfg(dir);
    for (const name of ["desktop", "web"]) {
      mkdirSync(join(cfg.profilesDir, name), { recursive: true });
      writeFileSync(join(cfg.profilesDir, name, "package.json"), "{}", "utf8");
    }
    expect(detectActiveProfile(cfg)).toBe(cfg.defaultProfile);
    rmSync(dir, { recursive: true, force: true });
  });

  it("目录全是空壳（无 package.json）→ 回默认", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-prof-"));
    const cfg = makeCfg(dir);
    mkdirSync(join(cfg.profilesDir, "desktop"), { recursive: true });
    expect(detectActiveProfile(cfg)).toBe(cfg.defaultProfile);
    rmSync(dir, { recursive: true, force: true });
  });

  it("profilesDir 不存在 → 回默认", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-prof-"));
    const cfg = makeCfg(dir);
    expect(detectActiveProfile(cfg)).toBe(cfg.defaultProfile);
    rmSync(dir, { recursive: true, force: true });
  });
});
