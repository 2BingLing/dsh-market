/**
 * install-parse 单元测试：README 安装命令提取
 * #394 · 变量引用的下载行过滤（`curl -o "$PURGE_INSTALL_DIR/install.sh"` 依赖前文变量，
 * 单独收录既装不了也误导）
 */
import { describe, expect, it } from "vitest";
import { parseInstallCommands, normalizeDshCliCmd } from "../src/install-parse.js";

describe("#394 · 依赖 shell 变量的下载行过滤", () => {
  it("dsh-purge 实例：curl 引用 $PURGE_INSTALL_DIR 的行被过滤，dsh add 命令保留", () => {
    const readme = [
      "## 安装",
      "",
      "先设置变量：",
      "",
      "```sh",
      'export PURGE_INSTALL_DIR=~/.dsh/profiles/web',
      'dsh plugin --profile web add "https://github.com/kingcharleslzy-ai/dsh-purge/releases/download/v1.7.20/dsh-purge-community-1.7.20.tgz"',
      'curl -fSL --connect-timeout 20 --max-time 90 "https://raw.githubusercontent.com/kingcharleslzy-ai/dsh-purge/master/scripts/install.sh" -o "$PURGE_INSTALL_DIR/install.sh"',
      "```",
    ].join("\n");
    const r = parseInstallCommands(readme);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toContain("dsh-purge-community-1.7.20.tgz");
    expect(r.commands[0]).not.toContain("install.sh");
  });

  it("不含变量的 curl 行不受影响（完整自包含的下载命令保留）", () => {
    const readme = [
      "## Install",
      "",
      "```sh",
      "curl -fsSL https://example.com/install.sh -o /tmp/install.sh",
      "```",
    ].join("\n");
    const r = parseInstallCommands(readme);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toContain("curl -fsSL");
  });
});

describe("#408 · npx @deepseek-ai/dsh 归一化 + curl|bash 禁录", () => {
  it("liustack/modlens 实例：npx -y @deepseek-ai/dsh plugin 归一为 dsh plugin", () => {
    const readme = [
      "## Install",
      "",
      "```sh",
      "npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modlens@3.27.5",
      "```",
    ].join("\n");
    const r = parseInstallCommands(readme);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toBe("dsh plugin --profile web add @liustack/modlens@3.27.5");
    expect(normalizeDshCliCmd("npx @deepseek-ai/dsh plugin --profile web add x")).toBe(
      "dsh plugin --profile web add x",
    );
  });

  it("Antigravity CLI 的 curl|bash 环境引导行不再被收录（modlens 实例）", () => {
    const readme = [
      "## Install",
      "",
      "If you don't want to sign up, use the Antigravity CLI:",
      "",
      "```sh",
      "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      "```",
      "",
      "Or install the plugin with dsh:",
      "",
      "```sh",
      "npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modlens@latest",
      "```",
    ].join("\n");
    const r = parseInstallCommands(readme);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).not.toContain("curl");
    expect(r.commands[0]).toContain("add @liustack/modlens");
  });

  it("modsearch 场景：npx skills add 保留、curl|bash 过滤", () => {
    const readme = [
      "## Install",
      "",
      "```sh",
      "npx skills add liustack/modsearch",
      "curl -fsSL https://example.com/cli/install.sh | bash",
      "```",
    ].join("\n");
    const r = parseInstallCommands(readme);
    expect(r.commands).toEqual(["npx skills add liustack/modsearch"]);
  });
});
