import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import {
  compareVersions,
  parseVersion,
  fetchNpmLatest,
  fetchRepoPushedAt,
  checkUpdates,
  checkSelfUpdate,
  applyUpdate,
  readMinimumReleaseAge,
  writeMinimumReleaseAge,
} from "../src/update.js";
import type { InstalledPlugin } from "../src/types.js";
import { makeMarket } from "./fixture.js";

const market = makeMarket();

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-update-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

/** 构造 npm 响应（registry /latest 端点） */
function npmOk(version: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ name: "x", version }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function ghOk(pushedAt: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ full_name: "a/b", pushed_at: pushedAt }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("parseVersion / compareVersions", () => {
  it("解析标准版本与预发布", () => {
    expect(parseVersion("1.2.3")).toEqual({ nums: [1, 2, 3], pre: [] });
    expect(parseVersion("v2.0.0-beta.1")?.pre).toEqual(["beta", "1"]);
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
  });

  it("数字大小比较", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("预发布规则：正式版更大，数字段小于字母段", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-rc")).toBe(-1);
  });

  it("无法解析时字典序兜底", () => {
    expect(compareVersions("abc", "def")).toBe(-1);
    expect(compareVersions("abc", "abc")).toBe(0);
  });
});

describe("fetchNpmLatest", () => {
  it("返回最新版本", async () => {
    const v = await fetchNpmLatest("some-pkg", npmOk("1.2.3"));
    expect(v).toBe("1.2.3");
  });

  it("404 / 网络失败 → null（并缓存，不重复请求）", async () => {
    const f = vi.fn(async () => new Response("not found", { status: 404 }));
    expect(await fetchNpmLatest("missing-pkg", f)).toBeNull();
    expect(await fetchNpmLatest("missing-pkg", f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1); // 命中缓存
  });
});

describe("fetchRepoPushedAt", () => {
  it("返回 pushed_at", async () => {
    const v = await fetchRepoPushedAt("a/b", ghOk("2026-08-14T00:00:00Z"));
    expect(v).toBe("2026-08-14T00:00:00Z");
  });
});

describe("checkUpdates", () => {
  it("cordis 型：本地旧版本 + npm 有新版 → hasUpdate，kind=npm", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      {
        pluginId: "feishu/feishu-doc",
        localName: "feishu-doc",
        version: "1.0.0",
        source: "profile",
        plugin: market.plugins.find((p) => p.id === "feishu/feishu-doc")!,
      },
    ];
    const results = await checkUpdates(cfg, installed, { fetchImpl: npmOk("2.0.0") });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.kind).toBe("npm");
    expect(r.current).toBe("1.0.0");
    expect(r.latest).toBe("2.0.0");
    expect(r.hasUpdate).toBe(true);
  });

  it("cordis 型：本地已最新 → hasUpdate=false", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      {
        pluginId: null,
        localName: "pkg-a",
        version: "1.2.0",
        source: "profile",
        plugin: null,
      },
    ];
    const results = await checkUpdates(cfg, installed, { fetchImpl: npmOk("1.2.0") });
    expect(results[0].hasUpdate).toBe(false);
    expect(results[0].latest).toBe("1.2.0");
  });

  it("cordis 型：本地版本缺失（git/路径依赖）→ none", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      { pluginId: null, localName: "git-dep", version: null, source: "profile", plugin: null },
    ];
    const results = await checkUpdates(cfg, installed, { fetchImpl: npmOk("1.0.0") });
    expect(results[0].kind).toBe("none");
    expect(results[0].hasUpdate).toBe(false);
  });

  it("cordis 型：npm 查不到但被市场收录 → 降级 GitHub 检测（远端有新提交）", async () => {
    const cfg = makeCfg();
    // 模拟 git tarball 安装：profiles/web/node_modules/<localName> 实体目录
    const web = join(cfg.profilesDir, "web");
    mkdirSync(join(web, "node_modules", "at-file"), { recursive: true });
    const dir = join(web, "node_modules", "at-file");
    writeFileSync(join(dir, "package.json"), "{}");
    const oldTime = new Date("2026-01-01T00:00:00Z").getTime() / 1000;
    utimesSync(dir, oldTime, oldTime);
    const plugin = market.plugins.find((p) => p.id === "feishu/feishu-doc")!;
    const installed: InstalledPlugin[] = [
      { pluginId: plugin.id, localName: "at-file", version: "0.3.0", source: "profile", plugin },
    ];
    // 按 URL 分流：npm 404 → GitHub 正常返回 pushedAt
    const f = vi.fn(async (url: string) => {
      if (url.includes("registry.npmjs.org")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({ pushed_at: "2026-08-14T00:00:00Z" }), { status: 200 });
    });
    const results = await checkUpdates(cfg, installed, { fetchImpl: f });
    expect(results[0].kind).toBe("github");
    expect(results[0].current).toBe("0.3.0");
    expect(results[0].hasUpdate).toBe(true);
  });

  it("cordis 型：npm 查不到且本地安装晚于远端提交 → 已最新", async () => {
    const cfg = makeCfg();
    const web = join(cfg.profilesDir, "web");
    mkdirSync(join(web, "node_modules", "at-file"), { recursive: true });
    const dir = join(web, "node_modules", "at-file");
    const freshTime = Date.now() / 1000;
    utimesSync(dir, freshTime, freshTime);
    const plugin = market.plugins.find((p) => p.id === "feishu/feishu-doc")!;
    const installed: InstalledPlugin[] = [
      { pluginId: plugin.id, localName: "at-file", version: "0.3.0", source: "profile", plugin },
    ];
    const f = vi.fn(async (url: string) => {
      if (url.includes("registry.npmjs.org")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({ pushed_at: "2026-01-01T00:00:00Z" }), { status: 200 });
    });
    const results = await checkUpdates(cfg, installed, { fetchImpl: f });
    expect(results[0].kind).toBe("github");
    expect(results[0].hasUpdate).toBe(false);
  });

  it("skill 型：远端有新提交（pushedAt > 本地 mtime）→ hasUpdate，kind=github", async () => {
    const cfg = makeCfg();
    mkdirSync(cfg.skillsDir, { recursive: true });
    const dir = join(cfg.skillsDir, "web-scraper-latest");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "x");
    const oldTime = new Date("2026-01-01T00:00:00Z").getTime() / 1000;
    utimesSync(dir, oldTime, oldTime);
    const plugin = market.plugins.find((p) => p.id === "acme/web-scraper")!;
    const installed: InstalledPlugin[] = [
      { pluginId: plugin.id, localName: "web-scraper-latest", version: null, source: "skills", plugin },
    ];
    const results = await checkUpdates(
      cfg,
      installed,
      { fetchImpl: ghOk("2026-08-14T00:00:00Z") },
    );
    expect(results[0].kind).toBe("github");
    expect(results[0].hasUpdate).toBe(true);
  });

  it("skill 型：本地 mtime 晚于远端提交 → 已最新", async () => {
    const cfg = makeCfg();
    mkdirSync(cfg.skillsDir, { recursive: true });
    const dir = join(cfg.skillsDir, "web-scraper-latest");
    mkdirSync(dir, { recursive: true });
    const freshTime = Date.now() / 1000;
    utimesSync(dir, freshTime, freshTime);
    const plugin = market.plugins.find((p) => p.id === "acme/web-scraper")!;
    const installed: InstalledPlugin[] = [
      { pluginId: plugin.id, localName: "web-scraper-latest", version: null, source: "skills", plugin },
    ];
    const results = await checkUpdates(
      cfg,
      installed,
      { fetchImpl: ghOk("2026-01-01T00:00:00Z") },
    );
    expect(results[0].hasUpdate).toBe(false);
  });

  it("skill 型：未收录市场 → none", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      { pluginId: null, localName: "custom-skill", version: null, source: "skills", plugin: null },
    ];
    const results = await checkUpdates(cfg, installed, { fetchImpl: ghOk("2026-08-14T00:00:00Z") });
    expect(results[0].kind).toBe("none");
    expect(results[0].error).toContain("未收录");
  });

  it("force 时绕过缓存重新查询", async () => {
    const cfg = makeCfg();
    const installed: InstalledPlugin[] = [
      { pluginId: null, localName: "force-pkg", version: "1.0.0", source: "profile", plugin: null },
    ];
    const f = npmOk("1.5.0");
    await checkUpdates(cfg, installed, { fetchImpl: f });
    const results = await checkUpdates(cfg, installed, { force: true, fetchImpl: f });
    expect(results[0].hasUpdate).toBe(true);
    expect(f).toHaveBeenCalledTimes(2); // force 清缓存后重新请求
  });
});

describe("checkSelfUpdate", () => {
  it("npm 有新版本 → hasUpdate", async () => {
    const r = await checkSelfUpdate("0.1.2", { fetchImpl: npmOk("0.2.0"), force: true });
    expect(r.hasUpdate).toBe(true);
    expect(r.current).toBe("0.1.2");
    expect(r.latest).toBe("0.2.0");
  });

  it("当前已最新 / 本地版本更新 → 无更新", async () => {
    expect((await checkSelfUpdate("0.2.0", { fetchImpl: npmOk("0.2.0"), force: true })).hasUpdate).toBe(false);
    expect((await checkSelfUpdate("0.1.3", { fetchImpl: npmOk("0.1.2"), force: true })).hasUpdate).toBe(false);
  });

  it("npm 查询失败 → 无更新", async () => {
    const f = vi.fn(async () => new Response("err", { status: 500 }));
    const r = await checkSelfUpdate("0.1.2", { fetchImpl: f, force: true });
    expect(r.hasUpdate).toBe(false);
    expect(r.latest).toBeNull();
  });
});

// ---------- P0-3 applyUpdate：假更新防误报 ----------

/** mock runner：rev-parse 返回指定 sha，其余命令成功返回空输出 */
function runnerWithHead(headA: string | null, headB: string | null) {
  let reads = 0;
  return {
    run: vi.fn(async (command: string) => {
      if (command.includes("rev-parse")) {
        reads++;
        const sha = reads === 1 ? headA : headB;
        return { exitCode: sha ? 0 : 1, stdout: sha ? sha + "\n" : "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }),
  };
}

describe("applyUpdate · cordis 型", () => {
  it("版本真的变了 → applied + activation(restart)", async () => {
    const cfg = makeCfg();
    const plugin = market.plugins.find((p) => p.id === "feishu/feishu-doc")!;
    const web = join(cfg.profilesDir, "web");
    mkdirSync(join(web, "node_modules", "feishu-doc"), { recursive: true });
    writeFileSync(
      join(web, "node_modules", "feishu-doc", "package.json"),
      JSON.stringify({ name: "feishu-doc", version: "0.8.0", dsh: { bundle: { patch: "x" } } }),
    );
    // profile 真值：依赖 + bundles 都在，但 patch 未应用 → restart
    writeFileSync(
      join(web, "package.json"),
      JSON.stringify({
        dependencies: { "feishu-doc": "^0.8.0" },
        dsh: { profile: { bundles: ["feishu-doc"] } },
      }),
    );
    const item: InstalledPlugin = {
      pluginId: plugin.id,
      localName: "feishu-doc",
      version: "0.8.0",
      source: "profile",
      plugin,
    };
    // 模拟 pnpm add 真实升级磁盘版本（before 0.8.0 → after 0.9.0）
    const runner = {
      run: vi.fn(async (command: string) => {
        if (command.includes("add feishu-doc@latest")) {
          writeFileSync(
            join(web, "node_modules", "feishu-doc", "package.json"),
            JSON.stringify({ name: "feishu-doc", version: "0.9.0", dsh: { bundle: { patch: "x" } } }),
          );
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    };
    const r = await applyUpdate(cfg, plugin, item, { runner, profile: "web", fetchImpl: npmOk("0.9.0") });
    expect(r.applied).toBe(true);
    expect(r.noChange).toBe(false);
    expect(r.before).toBe("0.8.0");
    expect(r.after).toBe("0.9.0");
    expect(r.activation?.state).toBe("restart"); // 已入 bundles，patch 未应用 → 重启后生效
  });

  it("版本未变 + npm 有更高版 → blocked=minimum-release-age（假更新防误报）", async () => {
    const cfg = makeCfg();
    const plugin = market.plugins.find((p) => p.id === "feishu/feishu-doc")!;
    const web = join(cfg.profilesDir, "web");
    mkdirSync(join(web, "node_modules", "feishu-doc"), { recursive: true });
    writeFileSync(
      join(web, "node_modules", "feishu-doc", "package.json"),
      JSON.stringify({ name: "feishu-doc", version: "0.8.0" }),
    );
    writeFileSync(join(web, "package.json"), JSON.stringify({ dependencies: { "feishu-doc": "^0.8.0" } }));
    const item: InstalledPlugin = {
      pluginId: plugin.id,
      localName: "feishu-doc",
      version: "0.8.0",
      source: "profile",
      plugin,
    };
    const runner = { run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) };
    const r = await applyUpdate(cfg, plugin, item, { runner, profile: "web", fetchImpl: npmOk("9.9.9") });
    expect(r.applied).toBe(false);
    expect(r.noChange).toBe(true);
    expect(r.blocked).toBe("minimum-release-age");
    expect(r.reason).toContain("9.9.9");
  });

  it("版本未变 + npm 无更高版 → 已是最新", async () => {
    const cfg = makeCfg();
    const plugin = market.plugins.find((p) => p.id === "feishu/feishu-doc")!;
    const web = join(cfg.profilesDir, "web");
    mkdirSync(join(web, "node_modules", "feishu-doc"), { recursive: true });
    writeFileSync(
      join(web, "node_modules", "feishu-doc", "package.json"),
      JSON.stringify({ name: "feishu-doc", version: "0.8.0" }),
    );
    writeFileSync(join(web, "package.json"), JSON.stringify({ dependencies: { "feishu-doc": "^0.8.0" } }));
    const item: InstalledPlugin = {
      pluginId: plugin.id,
      localName: "feishu-doc",
      version: "0.8.0",
      source: "profile",
      plugin,
    };
    const r = await applyUpdate(cfg, plugin, item, {
      runner: { run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) },
      profile: "web",
      fetchImpl: npmOk("0.8.0"),
    });
    expect(r.applied).toBe(false);
    expect(r.noChange).toBe(true);
    expect(r.reason).toContain("已是最新");
  });
});

describe("applyUpdate · skill 型（HEAD 对比）", () => {
  function skillSetup() {
    const cfg = makeCfg();
    mkdirSync(cfg.skillsDir, { recursive: true });
    const plugin = market.plugins.find((p) => p.id === "acme/web-scraper")!;
    const item: InstalledPlugin = {
      pluginId: plugin.id,
      localName: "web-scraper-latest",
      version: null,
      source: "skills",
      plugin,
    };
    return { cfg, plugin, item };
  }

  it("HEAD 未变化 → noChange（上游无新提交）", async () => {
    const { cfg, plugin, item } = skillSetup();
    const runner = runnerWithHead("a".repeat(40), "a".repeat(40));
    const r = await applyUpdate(cfg, plugin, item, { runner });
    expect(r.applied).toBe(true);
    expect(r.noChange).toBe(true);
    expect(r.reason).toContain("无新提交");
  });

  it("HEAD 变化 → 真正更新", async () => {
    const { cfg, plugin, item } = skillSetup();
    const runner = runnerWithHead("a".repeat(40), "b".repeat(40));
    const r = await applyUpdate(cfg, plugin, item, { runner });
    expect(r.applied).toBe(true);
    expect(r.noChange).toBe(false);
    expect(r.before).toBe("a".repeat(40));
    expect(r.after).toBe("b".repeat(40));
  });
});

describe("minimumReleaseAge 读写", () => {
  it("未设置 → null；写入 0 → 读取 0 且保留原内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-mra-"));
    expect(readMinimumReleaseAge(dir)).toBeNull();
    const r = writeMinimumReleaseAge(dir, 0);
    expect(r.ok).toBe(true);
    expect(readMinimumReleaseAge(dir)).toBe(0);
  });

  it("已设置 → 读取原值，可覆盖", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dshm-mra-"));
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "minimumReleaseAge: 86400\npackages:\n  - x\n", "utf8");
    expect(readMinimumReleaseAge(dir)).toBe(86400);
    writeMinimumReleaseAge(dir, 0);
    const raw = (await import("node:fs")).readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(raw).toContain("packages:\n  - x");
    expect(raw).toContain("minimumReleaseAge: 0");
  });
});
