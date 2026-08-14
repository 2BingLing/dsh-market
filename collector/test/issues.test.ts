import { describe, expect, it } from "vitest";
import { extractRepoFromText } from "../src/sources/issues.js";

describe("extractRepoFromText", () => {
  it("从 issue 正文提取仓库地址", () => {
    const text = "仓库：https://github.com/foo/bar 请收录";
    expect(extractRepoFromText(text)).toEqual(["foo/bar"]);
  });

  it("兼容多种 URL 后缀（tree/blob/issues/.git）", () => {
    expect(
      extractRepoFromText("https://github.com/a/b/tree/main x https://github.com/c/d/issues/1 https://github.com/e/f.git")
    ).toEqual(["a/b", "c/d", "e/f"]);
  });

  it("过滤非仓库路径（github.com 自身/本仓库/issues 等）", () => {
    const text = "https://github.com/settings https://github.com/github/foo https://github.com/2BingLing/dsh-market https://github.com/x/issues";
    expect(extractRepoFromText(text)).toEqual([]);
  });

  it("大小写归一化", () => {
    expect(extractRepoFromText("https://github.com/MyOrg/MyRepo")).toEqual(["myorg/myrepo"]);
  });

  it("去重", () => {
    expect(
      extractRepoFromText("https://github.com/a/b 和 https://github.com/A/B")
    ).toEqual(["a/b"]);
  });

  it("无仓库地址返回空", () => {
    expect(extractRepoFromText("这是一个普通 issue")).toEqual([]);
  });
});
