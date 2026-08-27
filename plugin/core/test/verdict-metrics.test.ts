import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";
import { parseInstallVerdict } from "../src/router.js";
import { metricSummary, recordInstallMetric } from "../src/metrics.js";

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dshm-metric-"));
  return resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
}

describe("parseInstallVerdict · T1 协议 JSON 解析", () => {
  it("纯 JSON：ok+commands+smoke+fail", () => {
    const text = JSON.stringify({
      ok: true,
      commands: ["dsh plugin --profile web add foo"],
      smoke: ["node -e 1"],
      fail: "",
      config_needed: null,
      recipe: { commands: ["dsh plugin --profile web add foo"], smoke: ["node -e 1"] },
    });
    const v = parseInstallVerdict(text);
    expect(v?.ok).toBe(true);
    expect(v?.commands).toEqual(["dsh plugin --profile web add foo"]);
    expect(v?.recipe?.commands).toHaveLength(1);
  });

  it("容忍 ```json 围栏与前后杂文本", () => {
    const text = [
      "好的，以下是结果：",
      "```json",
      JSON.stringify({ ok: true, commands: ["echo hi"], smoke: ["echo ok"], config_needed: null }),
      "```",
      "以上。",
    ].join("\n");
    const v = parseInstallVerdict(text);
    expect(v?.ok).toBe(true);
    expect(v?.commands).toEqual(["echo hi"]);
  });

  it("config_needed 提取 what/hint", () => {
    const v = parseInstallVerdict(
      JSON.stringify({ ok: false, config_needed: { what: "API Key", hint: "在 Settings 页获取" } }),
    );
    expect(v?.configNeeded?.what).toBe("API Key");
    expect(v?.configNeeded?.hint).toContain("Settings");
  });

  it("无 ok 字段 / 非 JSON → null", () => {
    expect(parseInstallVerdict('{"commands":["x"]}')).toBeNull();
    expect(parseInstallVerdict("安装失败了，网络超时")).toBeNull();
    expect(parseInstallVerdict("")).toBeNull();
  });

  it("失败 verdict：ok=false + fail 原因", () => {
    const v = parseInstallVerdict(JSON.stringify({ ok: false, fail: "网络超时", config_needed: null }));
    expect(v?.ok).toBe(false);
    expect(v?.fail).toBe("网络超时");
  });
});

describe("metrics · 安装埋点与聚合", () => {
  it("记录 + 汇总：T0/T1/一键安装 计数与命中率", () => {
    const cfg = makeCfg();
    recordInstallMetric(cfg, { ts: "t1", pluginId: "a/1", type: "ai", mode: "parsed", ok: true });
    recordInstallMetric(cfg, { ts: "t2", pluginId: "a/2", type: "ai", mode: "recipe", ok: true });
    recordInstallMetric(cfg, { ts: "t3", pluginId: "a/3", type: "ai", mode: "t1", ok: false, phase: "start", error: "无解析命令" });
    recordInstallMetric(cfg, { ts: "t4", pluginId: "a/3", type: "ai", mode: "t1", ok: true, phase: "done", recipeLearned: true, sessionChars: 4200 });
    recordInstallMetric(cfg, { ts: "t5", pluginId: "a/4", type: "install", mode: "direct", ok: true, recipeLearned: true });
    const s = metricSummary(cfg);
    expect(s.total).toBe(5);
    // t1 只计 done → byMode {parsed:1, recipe:1, t1:1, direct:1}
    expect(s.byMode).toEqual({ parsed: 1, recipe: 1, t1: 1, direct: 1 });
    expect(s.t0Rate).toBeCloseTo(2 / 3);
    expect(s.aiRate).toBeCloseTo(1 / 3);
    expect(s.okRate).toBeCloseTo(4 / 4);
    expect(s.avgSessionChars).toBe(4200);
  });

  it("损坏行跳过；空文件摘要归零", () => {
    const cfg = makeCfg();
    expect(metricSummary(cfg).total).toBe(0);
    const dir = join(cfg.dataDir, "metrics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "install-events.jsonl"), "{bad\n", "utf8");
    const s = metricSummary(cfg);
    expect(s.total).toBe(0);
    expect(s.t0Rate).toBe(0);
    expect(s.okRate).toBe(0);
  });

  it("recent 倒序返回最近 10 条", () => {
    const cfg = makeCfg();
    for (let i = 0; i < 12; i++) {
      recordInstallMetric(cfg, { ts: `t${i}`, pluginId: `p/${i}`, type: "ai", mode: "parsed", ok: true });
    }
    const s = metricSummary(cfg);
    expect(s.recent).toHaveLength(10);
    expect(s.recent[0]?.ts).toBe("t11");
    expect(s.byMode.parsed).toBe(12);
  });
});