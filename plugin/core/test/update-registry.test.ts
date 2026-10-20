/**
 * #265 · 更新检测与安装同源（npm registry）测试
 *
 * 场景：用户 pnpm 配置了 npmmirror，官方源已发布新版而镜像未同步——
 * 检测若走官方源会显示「可更新」但安装永远装不上。修复后检测与安装
 * 共用 pnpm 实际配置的 registry。
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNpmRegistry, fetchNpmLatest, checkUpdates } from "../src/update.js";
import { resolveConfig } from "../src/config.js";
import type { CommandRunner, InstalledPlugin } from "../src/types.js";

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-reg-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

function mockRunner(stdout: string, exitCode = 0) {
  const commands: string[] = [];
  const runner = {
    run: vi.fn(async (command: string) => {
      commands.push(command);
      return { exitCode, stdout, stderr: "" };
    }),
  } as unknown as CommandRunner;
  return { runner, commands };
}

/** 记录全部请求 URL 的 fetch mock（一律返回 200 + 指定版本） */
function captureFetch(version: string) {
  const attempted: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    attempted.push(url);
    return new Response(JSON.stringify({ name: "x", version }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, attempted };
}

describe("#265 registry 同源", () => {
  it("resolveNpmRegistry：读取 pnpm 配置的镜像源并去掉尾部斜杠", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-regdir-"));
    const { runner, commands } = mockRunner("https://registry.npmmirror.com/\n");
    const r = await resolveNpmRegistry(dir, runner);
    expect(r).toBe("https://registry.npmmirror.com");
    expect(commands[0]).toContain("pnpm config get registry");
    expect(commands[0]).not.toContain("cd ");
  });

  it("resolveNpmRegistry：pnpm 失败 → 官方源兜底；同 profileDir 走进程级缓存", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-regdir-"));
    const { runner, commands } = mockRunner("", 1);
    const r1 = await resolveNpmRegistry(dir, runner);
    expect(r1).toBe("https://registry.npmjs.org");
    const r2 = await resolveNpmRegistry(dir, runner);
    expect(r2).toBe("https://registry.npmjs.org");
    expect(commands.length).toBe(1); // 缓存生效：第二次不再跑 pnpm
  });

  it("fetchNpmLatest：使用指定 registry 查询 latest", async () => {
    const { impl, attempted } = captureFetch("2.0.10");
    const v = await fetchNpmLatest("dsh-plugin-rea", impl, "https://registry.npmmirror.com");
    expect(v).toBe("2.0.10");
    expect(attempted[0]).toBe("https://registry.npmmirror.com/dsh-plugin-rea/latest");
  });

  it("不同 registry 的缓存相互独立（官方 2.0.10 / 镜像 2.0.9 不串）", async () => {
    const official = captureFetch("2.0.10");
    const mirror = captureFetch("2.0.9");
    const v1 = await fetchNpmLatest("pkg-x", official.impl, "https://registry.npmjs.org");
    const v2 = await fetchNpmLatest("pkg-x", mirror.impl, "https://registry.npmmirror.com");
    expect(v1).toBe("2.0.10");
    expect(v2).toBe("2.0.9");
    expect(official.attempted[0]).toContain("registry.npmjs.org");
    expect(mirror.attempted[0]).toContain("registry.npmmirror.com");
  });

  it("checkUpdates 把 registry 串到 fetch（检测与安装同源）", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      { pluginId: null, localName: "pkg-a", version: "1.0.0", source: "profile", plugin: null },
    ];
    const { impl, attempted } = captureFetch("2.0.0");
    const results = await checkUpdates(cfg, installed, {
      fetchImpl: impl,
      registry: "https://registry.npmmirror.com",
    });
    expect(results[0].latest).toBe("2.0.0");
    expect(attempted[0]).toBe("https://registry.npmmirror.com/pkg-a/latest");
  });
});
