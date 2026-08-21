import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { installPlugin, isLockFailure, uninstallPlugin } from "../src/installer.js";
import type { CommandRunner, InstallStep } from "../src/types.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();
const skillPlugin = market.plugins.find((p) => p.type === "skill" && p.id === "acme/web-scraper")!;
const cordisPlugin = market.plugins.find((p) => p.type === "cordis-plugin" && p.id === "feishu/feishu-doc")!;

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-install-"));
  // 显式指定所有路径到临时目录，防止探测到真实用户目录（.agents/skills 等）
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

describe("installPlugin · skill 型", () => {
  it("dry-run 全流程步骤（不执行命令）", async () => {
    const cfg = makeCfg();
    const steps: InstallStep[] = [];
    const r = await installPlugin(cfg, skillPlugin, {
      dryRun: true,
      runner: runnerMock(),
      onStep: (s) => steps.push(s),
    });
    expect(r.ok).toBe(true);
    expect(steps.map((s) => s.id)).toContain("clone");
    // onStep 是状态变更通知流（running → done），取该步骤最后一条状态
    expect(steps.filter((s) => s.id === "clone").at(-1)?.status).toBe("done");
  });

  it("已装检测：目录存在 → alreadyInstalled 跳过", async () => {
    const cfg = makeCfg();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cfg.skillsDir, "web-scraper-latest"), { recursive: true });
    const r = await installPlugin(cfg, skillPlugin, { runner: runnerMock() });
    expect(r.alreadyInstalled).toBe(true);
  });

  it("命令失败重试 2 次后失败并回滚", async () => {
    const cfg = makeCfg();
    const runner = runnerMock({ fail: true });
    const r = await installPlugin(cfg, skillPlugin, { runner });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    // 重试次数 = MAX_RETRY + 1 次调用
    expect(runner.run).toHaveBeenCalledTimes(3);
    // 回滚：目标目录不存在
    expect(existsSync(join(cfg.skillsDir, "web-scraper-latest"))).toBe(false);
  });

  it("文件占用（EPERM）类失败：不重试，立即失败并带可操作提示", async () => {
    const cfg = makeCfg();
    // 模拟运行时 harness 占用文件导致的 EPERM（P0 修复：避免 3×180s 假死）
    const runner: CommandRunner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "ERR_PNPM_EPERM EPERM: operation not permitted, unlink ...",
      })),
    };
    const r = await installPlugin(cfg, skillPlugin, { runner });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("文件被占用");
    // 只调用 1 次（不触发重试）
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});

describe("isLockFailure", () => {
  it("识别 Windows 文件占用/权限类错误", () => {
    expect(isLockFailure("EPERM: operation not permitted, unlink")).toBe(true);
    expect(isLockFailure("EBUSY: resource busy or locked")).toBe(true);
    expect(isLockFailure("Access is denied")).toBe(true);
    expect(isLockFailure("426 Insecure Underlying Transport")).toBe(false);
    expect(isLockFailure("ETIMEDOUT")).toBe(false);
  });
});

describe("installPlugin · cordis 型", () => {
  it("dry-run 全流程：dsh plugin add 命令 + requiresRestart", async () => {
    const cfg = makeCfg();
    const runner = runnerMock();
    const r = await installPlugin(cfg, cordisPlugin, {
      dryRun: true,
      runner,
      targetProfile: "web",
    });
    expect(r.ok).toBe(true);
    expect(r.requiresRestart).toBe(true);
    expect(r.snapshot?.target).toBe("web");
  });

  it("已装检测：profile package.json 依赖存在 → 跳过", async () => {
    const cfg = makeCfg();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const profileDir = join(cfg.profilesDir, "web");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "package.json"),
      JSON.stringify({ dependencies: { "feishu-doc": "^1.0.0" } }),
    );
    const r = await installPlugin(cfg, cordisPlugin, {
      runner: runnerMock(),
      targetProfile: "web",
    });
    expect(r.alreadyInstalled).toBe(true);
  });

  it("命令失败 → 回滚调用 remove", async () => {
    const cfg = makeCfg();
    const runner = runnerMock({ fail: true });
    const r = await installPlugin(cfg, cordisPlugin, {
      runner,
      targetProfile: "web",
    });
    expect(r.ok).toBe(false);
    // remove 命令也被调用（回滚）
    const calls = (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(calls.some((c) => c.includes("remove"))).toBe(true);
  });
});

describe("uninstallPlugin", () => {
  it("skill 型：删除目录", async () => {
    const cfg = makeCfg();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cfg.skillsDir, "web-scraper-latest"), { recursive: true });
    const r = await uninstallPlugin(cfg, skillPlugin, { runner: runnerMock() });
    expect(r.ok).toBe(true);
    expect(existsSync(join(cfg.skillsDir, "web-scraper-latest"))).toBe(false);
  });

  it("cordis 型：调用 dsh plugin remove", async () => {
    const cfg = makeCfg();
    const runner = runnerMock();
    const r = await uninstallPlugin(cfg, cordisPlugin, {
      runner,
      targetProfile: "web",
    });
    expect(r.ok).toBe(true);
    const calls = (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(calls.some((c) => c.includes("remove"))).toBe(true);
  });

  it("cordis 型：优先用 localName（依赖键名，pnpm 大小写敏感）构造 remove 命令", async () => {
    const cfg = makeCfg();
    const runner = runnerMock();
    // 模拟真实场景：market name 是 GitHub 原始大小写（DSH-better-sidebar），
    // 依赖键名是小写（dsh-better-sidebar）——用 localName 才不会被 pnpm 拒绝
    const mixedCase = { ...cordisPlugin, name: "DSH-better-sidebar" };
    const r = await uninstallPlugin(cfg, mixedCase, {
      runner,
      targetProfile: "web",
      localName: "dsh-better-sidebar",
    });
    expect(r.ok).toBe(true);
    const calls = (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(calls.some((c) => c.includes("remove dsh-better-sidebar"))).toBe(true);
    // 绝不使用 GitHub 原始大小写
    expect(calls.some((c) => c.includes("remove DSH-better-sidebar"))).toBe(false);
  });

  it("skill 型：优先用 localName（目录名）删除", async () => {
    const cfg = makeCfg();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cfg.skillsDir, "custom-dir-name"), { recursive: true });
    const r = await uninstallPlugin(cfg, skillPlugin, {
      runner: runnerMock(),
      localName: "custom-dir-name",
    });
    expect(r.ok).toBe(true);
    expect(existsSync(join(cfg.skillsDir, "custom-dir-name"))).toBe(false);
  });

  it("cordis 型：命令失败 → ok:false + 错误信息（client 据此弹提示）", async () => {
    const cfg = makeCfg();
    const runner = runnerMock({ fail: true });
    const r = await uninstallPlugin(cfg, cordisPlugin, {
      runner,
      targetProfile: "web",
      localName: "dsh-better-sidebar",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
