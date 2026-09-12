import { describe, expect, it } from "vitest";
import { compareVersionsForRange, describeRange, parseVersionForRange, satisfiesRange } from "../src/version.js";
import { checkDshCompat } from "../src/compat.js";
import type { DshPlugin } from "@dsh-market/schema";

describe("parseVersionForRange", () => {
  it("常规与简写", () => {
    expect(parseVersionForRange("0.1.5")).toMatchObject({ major: 0, minor: 1, patch: 5, pre: null });
    expect(parseVersionForRange("v0.1.5")).toMatchObject({ major: 0, minor: 1, patch: 5 });
    expect(parseVersionForRange("1")).toMatchObject({ major: 1, minor: 0, patch: 0 });
    expect(parseVersionForRange("1.2")).toMatchObject({ major: 1, minor: 2, patch: 0 });
  });

  it("预发布与 build metadata", () => {
    expect(parseVersionForRange("0.1.5-rc.1")?.pre).toBe("rc.1");
    expect(parseVersionForRange("0.1.5+build.7")).toMatchObject({ patch: 5, pre: null });
  });

  it("非版本字符串 → null", () => {
    expect(parseVersionForRange("见 README")).toBeNull();
    expect(parseVersionForRange("")).toBeNull();
    expect(parseVersionForRange(null)).toBeNull();
  });
});

describe("satisfiesRange · 基本比较", () => {
  it(">= / > / <= / < / 精确", () => {
    expect(satisfiesRange("0.1.5", ">=0.1.5")).toBe(true);
    expect(satisfiesRange("0.1.4", ">=0.1.5")).toBe(false);
    expect(satisfiesRange("0.1.6", ">0.1.5")).toBe(true);
    expect(satisfiesRange("0.1.5", ">0.1.5")).toBe(false);
    expect(satisfiesRange("0.1.5", "<=0.1.5")).toBe(true);
    expect(satisfiesRange("0.1.5", "<0.1.5")).toBe(false);
    expect(satisfiesRange("0.1.5", "0.1.5")).toBe(true);
    expect(satisfiesRange("0.1.4", "0.1.5")).toBe(false);
  });

  it("caret ^：0.x 走 semver 的升级为次版本规则", () => {
    expect(satisfiesRange("0.1.9", "^0.1.2")).toBe(true);
    expect(satisfiesRange("0.1.1", "^0.1.2")).toBe(false);
    expect(satisfiesRange("0.2.0", "^0.1.2")).toBe(false);
    expect(satisfiesRange("1.9.0", "^1.2.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("tilde ~", () => {
    expect(satisfiesRange("0.1.9", "~0.1.2")).toBe(true);
    expect(satisfiesRange("0.2.0", "~0.1.2")).toBe(false);
    expect(satisfiesRange("0.1.0", "~0.1")).toBe(true);
  });

  it("通配段", () => {
    expect(satisfiesRange("0.1.5", "0.1.x")).toBe(true);
    expect(satisfiesRange("0.1.5", "0.1.*")).toBe(true);
    expect(satisfiesRange("0.2.0", "0.1.x")).toBe(false);
    expect(satisfiesRange("9.9.9", "*")).toBe(true);
  });

  it("AND（空格/逗号）与 OR（||）与连字符区间", () => {
    expect(satisfiesRange("0.1.5", ">=0.1.0 <0.2.0")).toBe(true);
    expect(satisfiesRange("0.2.0", ">=0.1.0 <0.2.0")).toBe(false);
    expect(satisfiesRange("0.1.5", ">=0.2.0 || >=0.1.0")).toBe(true);
    expect(satisfiesRange("0.1.5", "0.1.0 - 0.2.0")).toBe(true);
    expect(satisfiesRange("0.3.0", "0.1.0 - 0.2.0")).toBe(false);
  });

  it("空 / 无范围 / 无法解析 → null（= 未知，调用方不得当作 false）", () => {
    expect(satisfiesRange("0.1.5", "")).toBeNull();
    expect(satisfiesRange("0.1.5", null)).toBeNull();
    expect(satisfiesRange("0.1.5", undefined)).toBeNull();
    expect(satisfiesRange("0.1.5", "见 README")).toBeNull();
    expect(satisfiesRange(null, ">=0.1.5")).toBeNull();
  });

  /**
   * 2026-09-12 真实抽样（stars 前 60）得出：作者把 DSH 版本写进 devDependencies 时用的是
   * "我开发时用的那个版本"（裸 pin），**不是**兼容性声明 —— 实测 16 个可提取约束里有 9 个是裸 pin。
   * 若按 semver 精确匹配判定，会把大量其实能用的插件标成"不兼容"。
   * → 因此裸版本（含裸预发布）一律判"不可判定"，由 UI 按"未知"提示。
   */
  it("裸版本（无运算符）不按精确匹配判定，而是判为不可判定", () => {
    expect(satisfiesRange("0.1.5-rc.1", "0.1.5-rc.1")).toBeNull();
    expect(satisfiesRange("0.1.5", "0.1.5-rc.1")).toBeNull();
    // 但带运算符的预发布边界仍然正常判定（那是明确的兼容性表达）
    expect(satisfiesRange("0.1.5-rc.1", "^0.1.5-rc.1")).toBe(true);
    expect(satisfiesRange("0.1.5-rc.1", ">=0.1.5-rc.1")).toBe(true);
  });
});

/**
 * 关键回归：DSH 宿主常态就是 rc 版本，而标准 semver 会判 rc **不满足** >=正式版。
 * 若照标准来，本机 0.1.5-rc.1 对上插件声明的 >=0.1.5 会被判"不兼容"→ 错误地拦住安装。
 * 本模块采用 prerelease 宽容比较（只看三元组边界）。
 */
describe("satisfiesRange · prerelease 宽容（本项目的故意偏离）", () => {
  it("宿主 0.1.5-rc.1 满足作者的 >=0.1.5 / ^0.1.2 / ~0.1（否则会大面积误拦）", () => {
    expect(satisfiesRange("0.1.5-rc.1", ">=0.1.5")).toBe(true);
    expect(satisfiesRange("0.1.5-rc.1", "^0.1.2")).toBe(true);
    expect(satisfiesRange("0.1.5-rc.1", "~0.1.2")).toBe(true);
    expect(satisfiesRange("0.1.1-rc.2", ">=0.1.1 <0.2.0")).toBe(true);
  });

  it("宽容不等于乱放行：跨次版本仍判不兼容", () => {
    expect(satisfiesRange("0.2.0-rc.1", "^0.1.2")).toBe(false);
    expect(satisfiesRange("0.1.4-rc.1", ">=0.1.5")).toBe(false);
  });
});

describe("compareVersionsForRange / describeRange", () => {
  it("比较只看三元组", () => {
    expect(compareVersionsForRange("0.1.5", "0.1.5-rc.1")).toBe(0);
    expect(compareVersionsForRange("0.1.4", "0.1.5")).toBe(-1);
    expect(compareVersionsForRange("b", "0.1.5")).toBeNull();
  });

  it("describeRange 翻人话", () => {
    expect(describeRange(">=0.1.5")).toBe("DSH ≥ 0.1.5");
    expect(describeRange("^0.1.2")).toContain("0.1.2");
    expect(describeRange("*")).toBe("任意版本");
    expect(describeRange(null)).toBe("任意版本");
  });
});

/** 造一个最小插件（只用到 install 字段） */
function plugin(install: Partial<DshPlugin["install"]>): Pick<DshPlugin, "install" | "fullName"> {
  return {
    fullName: "someone/dsh-thing",
    install: { method: "pnpm-profile", needsConfig: false, ...install },
  };
}

describe("checkDshCompat · 门禁语义", () => {
  it("未声明宿主要求 → unknown 且不拦截", () => {
    const r = checkDshCompat(plugin({}), { localVersion: "0.1.5" });
    expect(r.status).toBe("unknown");
    expect(r.block).toBe(false);
    expect(r.reason).toContain("未声明");
  });

  it("本机版本读不到 → unknown 且不拦截（宁可漏提示，不可误拦）", () => {
    const r = checkDshCompat(plugin({ dshEngines: ">=0.1.5", dshEnginesSource: "engines" }), {
      localVersion: null,
    });
    expect(r.status).toBe("unknown");
    expect(r.block).toBe(false);
    expect(r.reason).toContain("读取失败");
  });

  it("兼容 → ok", () => {
    const r = checkDshCompat(plugin({ dshEngines: ">=0.1.5", dshEnginesSource: "engines" }), {
      localVersion: "0.1.5-rc.1",
    });
    expect(r.status).toBe("ok");
    expect(r.block).toBe(false);
  });

  it("作者显式声明且不兼容 → block=true", () => {
    const r = checkDshCompat(plugin({ dshEngines: ">=0.2.0", dshEnginesSource: "engines" }), {
      localVersion: "0.1.5",
    });
    expect(r.status).toBe("incompatible");
    expect(r.block).toBe(true);
    expect(r.reason).toContain("不兼容");
  });

  it("要求来自依赖推断 → 不阻断（可能只是开发期对齐）", () => {
    const r = checkDshCompat(plugin({ dshEngines: ">=0.2.0", dshEnginesSource: "peer-dep" }), {
      localVersion: "0.1.5",
    });
    expect(r.status).toBe("incompatible");
    expect(r.block).toBe(false);
    expect(r.soft).toBe(true);
  });

  it("范围不可解析 → unknown，不拦截", () => {
    const r = checkDshCompat(plugin({ dshEngines: "见 README", dshEnginesSource: "engines" }), {
      localVersion: "0.1.5",
    });
    expect(r.status).toBe("unknown");
    expect(r.block).toBe(false);
  });
});
