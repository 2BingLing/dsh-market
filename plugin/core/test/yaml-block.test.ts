import { describe, expect, it } from "vitest";
import {
  getListBlock,
  getScalar,
  getTrueMapBlock,
  mergeListBlock,
  mergeTrueMapBlock,
  setScalar,
} from "../src/yaml-block.js";

describe("mergeListBlock", () => {
  it("追加新块到末尾", () => {
    const yaml = "packages:\n  - 'profiles/*'\n";
    expect(mergeListBlock(yaml, "onlyBuiltDependencies", ["esbuild"])).toBe(
      "packages:\n  - 'profiles/*'\nonlyBuiltDependencies:\n  - esbuild\n",
    );
  });

  it("合并到已有块的子行（去重+排序按插入序）", () => {
    const yaml = "onlyBuiltDependencies:\n  - sharp\n  - esbuild\n";
    expect(mergeListBlock(yaml, "onlyBuiltDependencies", ["esbuild", "node-gyp"])).toBe(
      "onlyBuiltDependencies:\n  - sharp\n  - esbuild\n  - node-gyp\n",
    );
  });

  it("保留块后的其他顶层内容", () => {
    const yaml = "onlyBuiltDependencies:\n  - esbuild\n\npackages:\n  - 'app/*'\n";
    const out = mergeListBlock(yaml, "onlyBuiltDependencies", ["sharp"]);
    expect(out).toContain("packages:\n  - 'app/*'");
    expect(out.indexOf("packages:")).toBeGreaterThan(out.indexOf("- sharp"));
  });
});

describe("mergeTrueMapBlock", () => {
  it("追加 map 真值块", () => {
    const out = mergeTrueMapBlock("", "allowBuilds", ["esbuild", "node-gyp"]);
    expect(out).toBe("allowBuilds:\n  esbuild: true\n  node-gyp: true\n");
  });

  it("合并进已有 map 块", () => {
    const yaml = "allowBuilds:\n  sharp: true\n";
    const out = mergeTrueMapBlock(yaml, "allowBuilds", ["esbuild", "sharp"]);
    expect(out).toBe("allowBuilds:\n  sharp: true\n  esbuild: true\n");
  });
});

describe("getListBlock / getTrueMapBlock", () => {
  it("读取数组块", () => {
    expect(getListBlock("onlyBuiltDependencies:\n  - a\n  - b\n", "onlyBuiltDependencies")).toEqual([
      "a",
      "b",
    ]);
  });
  it("读取内联数组", () => {
    expect(getListBlock("onlyBuiltDependencies: [a, 'b']\n", "onlyBuiltDependencies")).toEqual([
      "a",
      "b",
    ]);
  });
  it("读取 map 真值块", () => {
    expect(getTrueMapBlock("allowBuilds:\n  esbuild: true\n  node-gyp: true\n", "allowBuilds")).toEqual([
      "esbuild",
      "node-gyp",
    ]);
  });
  it("不存在返回空", () => {
    expect(getListBlock("packages:\n  - x\n", "nope")).toEqual([]);
    expect(getTrueMapBlock("", "nope")).toEqual([]);
  });
});

describe("setScalar / getScalar", () => {
  it("无则追加", () => {
    const out = setScalar("packages:\n  - x\n", "minimumReleaseAge", 0);
    expect(out).toContain("minimumReleaseAge: 0");
    expect(out).toContain("packages:\n  - x");
    expect(getScalar(out, "minimumReleaseAge")).toBe("0");
  });
  it("有则替换", () => {
    const yaml = "minimumReleaseAge: 86400\n";
    const out = setScalar(yaml, "minimumReleaseAge", 0);
    expect(out).toBe("minimumReleaseAge: 0\n");
  });
  it("缺失返回 null", () => {
    expect(getScalar("packages:\n  - x\n", "minimumReleaseAge")).toBeNull();
  });
});
