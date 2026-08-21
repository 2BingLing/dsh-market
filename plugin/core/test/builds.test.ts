import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectPnpmMajor,
  isBuildBlockedFailure,
  parseBlockedBuilds,
  parsePnpmErrorCode,
  readBuildApprovals,
  writeBuildApprovals,
} from "../src/builds.js";
import type { CommandRunner } from "../src/types.js";

describe("parseBlockedBuilds", () => {
  it("解析单包", () => {
    expect(parseBlockedBuilds("Ignored build scripts: esbuild")).toEqual(["esbuild"]);
  });

  it("解析多包（去版本号）", () => {
    expect(
      parseBlockedBuilds("Ignored build scripts: esbuild@0.25.4, node-gyp, sharp@0.33.5."),
    ).toEqual(["esbuild", "node-gyp", "sharp"]);
  });

  it("无匹配返回空", () => {
    expect(parseBlockedBuilds("some other error")).toEqual([]);
    expect(parseBlockedBuilds("")).toEqual([]);
  });
});

describe("parsePnpmErrorCode / isBuildBlockedFailure", () => {
  it("提取错误码", () => {
    expect(parsePnpmErrorCode("ERR_PNPM_NO_MATCHING_VERSION 1.0.0")).toBe(
      "ERR_PNPM_NO_MATCHING_VERSION",
    );
    expect(parsePnpmErrorCode("plain error")).toBeNull();
  });

  it("判定构建脚本被拦", () => {
    expect(isBuildBlockedFailure("Ignored build scripts: esbuild")).toBe(true);
    expect(isBuildBlockedFailure("run pnpm approve-builds")).toBe(true);
    expect(isBuildBlockedFailure("ERR_PNPM_FETCH_404")).toBe(false);
  });
});

describe("writeBuildApprovals / readBuildApprovals", () => {
  function makeProfile() {
    const dir = mkdtempSync(join(tmpdir(), "dshm-builds-"));
    return dir;
  }

  it("pnpm10：写 onlyBuiltDependencies 数组，保留原内容", () => {
    const dir = makeProfile();
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'profiles/*'\nonlyBuiltDependencies:\n  - sharp\n",
      "utf8",
    );
    const r = writeBuildApprovals(dir, ["esbuild", "sharp"], { pnpmMajor: 10 });
    expect(r.ok).toBe(true);
    expect(r.key).toBe("onlyBuiltDependencies");
    const raw = readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(raw).toContain("packages:\n  - 'profiles/*'"); // 原内容保留
    expect(raw).toMatch(/onlyBuiltDependencies:\n  - sharp\n  - esbuild/);
    expect(readBuildApprovals(dir, 10)).toEqual(["sharp", "esbuild"]);
  });

  it("pnpm11：写 allowBuilds map（pkg: true）", () => {
    const dir = makeProfile();
    const r = writeBuildApprovals(dir, ["esbuild", "node-gyp"], { pnpmMajor: 11 });
    expect(r.ok).toBe(true);
    expect(r.key).toBe("allowBuilds");
    const raw = readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(raw).toMatch(/allowBuilds:\n  esbuild: true\n  node-gyp: true/);
    expect(readBuildApprovals(dir, 11)).toEqual(["esbuild", "node-gyp"]);
  });

  it("已存在同包时不重复（去重）", () => {
    const dir = makeProfile();
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "onlyBuiltDependencies:\n  - esbuild\n", "utf8");
    writeBuildApprovals(dir, ["esbuild", "sharp"], { pnpmMajor: 10 });
    const raw = readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(raw.match(/- esbuild/g)).toHaveLength(1);
    expect(readBuildApprovals(dir, 10)).toEqual(["esbuild", "sharp"]);
  });

  it("空包名 → ok:false", () => {
    const dir = makeProfile();
    const r = writeBuildApprovals(dir, ["", "  "], { pnpmMajor: 10 });
    expect(r.ok).toBe(false);
  });

  it("dryRun 不落盘", () => {
    const dir = makeProfile();
    const r = writeBuildApprovals(dir, ["esbuild"], { pnpmMajor: 10, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.written).toBe(false);
  });
});

describe("detectPnpmMajor", () => {
  function runnerReturning(version: string | null): CommandRunner {
    return {
      run: async () =>
        version === null
          ? { exitCode: 1, stdout: "", stderr: "pnpm: command not found" }
          : { exitCode: 0, stdout: version + "\n", stderr: "" },
    };
  }

  it("pnpm 10 → 10", async () => {
    expect(await detectPnpmMajor({ runner: runnerReturning("10.9.3") })).toBe(10);
  });
  it("pnpm 11 → 11", async () => {
    expect(await detectPnpmMajor({ runner: runnerReturning("11.2.0") })).toBe(11);
  });
  it("无法探测 → 回退 10", async () => {
    expect(await detectPnpmMajor({ runner: runnerReturning(null) })).toBe(10);
  });
});
