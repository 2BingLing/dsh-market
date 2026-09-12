/**
 * P6 测试：错误分类（classifyFailure）+ 操作日志（appendOpLog / readOpLogTail / exportLogText）
 */
import { describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure } from "../src/errors.js";
import { appendOpLog, exportLogText, readOpLogTail } from "../src/log.js";
import type { ResolvedConfig } from "../src/config.js";

describe("classifyFailure", () => {
  it("网络类", () => {
    const r = classifyFailure("pnpm install failed: fetch failed ETIMEDOUT after 30s");
    expect(r.code).toBe("network");
    expect(r.title).toContain("网络");
    expect(r.hint.length).toBeGreaterThan(4);
  });

  it("限流类（优先于 network 的 403）", () => {
    const r = classifyFailure("GET /repos/x/y 403 API rate limit exceeded");
    expect(r.code).toBe("rate-limit");
  });

  it("文件占用（Windows EPERM/EBUSY 场景，优先于 permission）", () => {
    const r = classifyFailure("copy failed: EBUSY: resource busy or locked, unlink 'C:\\x\\y.js'");
    expect(r.code).toBe("file-locked");
  });

  it("404 / 包不存在", () => {
    const r = classifyFailure("npm ERR! 404 Not Found - GET https://registry.npmjs.org/@foo/bar");
    expect(r.code).toBe("not-found");
  });

  it("版本约束冲突", () => {
    const r = classifyFailure("ERESOLVE unable to resolve dependency tree: peer dep conflict");
    expect(r.code).toBe("version");
  });

  it("磁盘", () => {
    const r = classifyFailure("write failed: ENOSPC: no space left on device");
    expect(r.code).toBe("disk");
  });

  it("未知兜底也有关键行与可用提示，绝不抛错/返回空", () => {
    const r = classifyFailure("some totally alien failure\nsecond line\nstack at foo");
    expect(r.code).toBe("unknown");
    expect(r.keyLines.length).toBeGreaterThan(0);
    expect(r.hint).toContain("复制诊断");
  });

  it("空输入/undefined 也安全", () => {
    const r = classifyFailure("");
    expect(r.code).toBe("unknown");
    expect(r.keyLines.length).toBeGreaterThanOrEqual(0);
  });
});

describe("操作日志（appendOpLog / readOpLogTail / exportLogText）", () => {
  function makeCfg(): ResolvedConfig {
    const dir = mkdtempSync(join(tmpdir(), "dshm-log-"));
    return {
      dshHome: dir,
      skillsDir: join(dir, "skills"),
      profilesDir: join(dir, "profiles"),
      dataDir: join(dir, "data"),
      defaultProfile: "web",
      remoteUrl: "https://example.invalid/plugins.json",
      liteUrl: "https://example.invalid/plugins-lite.json",
      localDataPath: null,
      cacheTtlMs: 86400_000,
    };
  }

  it("追加→读取尾部（顺序保持，字段完整）", () => {
    const cfg = makeCfg();
    appendOpLog(cfg, { t: "2026-09-12T08:00:00Z", op: "install", ok: true, target: "a/b" });
    appendOpLog(cfg, {
      t: "2026-09-12T08:01:00Z",
      op: "install",
      ok: false,
      code: "network",
      msg: "网络不通或不稳定",
      target: "c/d",
      detail: "fetch failed\nETIMEDOUT",
    });
    const tail = readOpLogTail(cfg, 10);
    expect(tail).toHaveLength(2);
    expect(tail[0].op).toBe("install");
    expect(tail[0].ok).toBe(true);
    expect(tail[1].code).toBe("network");
    expect(tail[1].detail).toContain("ETIMEDOUT");
  });

  it("detail 超长被截断到尾部（保留最后的错误行）", () => {
    const cfg = makeCfg();
    const long = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n");
    appendOpLog(cfg, { t: "t", op: "update", ok: false, code: "unknown", msg: "m", target: "x/y", detail: long });
    const tail = readOpLogTail(cfg, 1);
    expect(tail[0].detail).toContain("line-99");
    expect(tail[0].detail!.length).toBeLessThan(600);
  });

  it("导出文本含宿主版本/探测来源/时区头", () => {
    const cfg = makeCfg();
    appendOpLog(cfg, { t: "2026-09-12T08:00:00Z", op: "uninstall", ok: true, target: "e/f" });
    const text = exportLogText(cfg, { "@dsh-market/plugin": "0.4.7" });
    expect(text).toContain("【插件市场操作日志】");
    expect(text).toContain("时区:");
    expect(text).toContain("DSH 宿主:");
    expect(text).toContain("探测来源");
    expect(text).toContain("uninstall OK e/f");
    expect(text).toContain("plugin 0.4.7");
  });

  it("日志文件里有坏行时读取/导出不抛错（跳过坏行）", () => {
    const cfg = makeCfg();
    appendOpLog(cfg, { t: "2026-09-12T08:00:00Z", op: "install", ok: true, target: "g/h" });
    // 往日志文件追加一行坏数据，读取必须跳过且不抛错
    appendFileSync(join(cfg.dataDir, "logs", "market-oplog.jsonl"), "{broken json\n", "utf-8");
    const tail = readOpLogTail(cfg, 10);
    expect(tail).toHaveLength(1);
    expect(tail[0].target).toBe("g/h");
    expect(() => exportLogText(cfg)).not.toThrow();
  });

  it("空日志导出不抛错，显示暂无记录", () => {
    const cfg = makeCfg();
    const text = exportLogText(cfg);
    expect(text).toContain("（暂无记录）");
  });

  it("写入不可用路径时静默放弃（不抛错）", () => {
    const cfg = makeCfg();
    // dataDir 指向一个"文件"，mkdir/append 必然失败 → append 必须静默
    const broken: ResolvedConfig = {
      ...cfg,
      dataDir: join(cfg.dataDir, "blocker"),
    };
    mkdirSync(cfg.dataDir, { recursive: true });
    writeFileSync(broken.dataDir, "blocker", "utf-8");
    expect(() => appendOpLog(broken, { t: "t", op: "install", ok: false })).not.toThrow();
    expect(readOpLogTail(broken)).toEqual([]);
  });
});
