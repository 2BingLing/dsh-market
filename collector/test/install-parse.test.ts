/**
 * install-parse 单元测试：README 安装命令提取
 * #394 · 变量引用的下载行过滤（`curl -o "$PURGE_INSTALL_DIR/install.sh"` 依赖前文变量，
 * 单独收录既装不了也误导）
 */
import { describe, expect, it } from "vitest";
import { parseInstallCommands } from "../src/install-parse.js";

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
