import { describe, expect, it } from "vitest";
import { scoreEase } from "../src/scoring.js";
import { detectNeedsConfig } from "../src/detect.js";

const description = "A documented plugin with local workspaces and reproducible installation. ".repeat(3);
function readme(command: string, heading = "# Example") {
  return `${heading}\n${description}\n## Installation\n\`\`\`sh\n${command}\n\`\`\`\n`;
}
describe("documented installation scoring", () => {
  it.each([
    "dsh plugin --profile web add -w example-plugin@1.0.0",
    "dsh plugin --profile web add https://example.com/plugin.tgz",
    "dsh plugin add github:author/plugin",
  ])("recognizes official DSH installation: %s", command => {
    expect(scoreEase(readme(command), false)).toBe(100);
    expect(scoreEase(readme(command), true)).toBe(65);
  });
  it("recognizes an HTML title without requiring a Markdown duplicate", () => {
    expect(scoreEase(readme("dsh plugin add example-plugin", '<h1 align="center">Example</h1>'), false)).toBe(100);
  });
  it("does not treat a removal command as installation", () => {
    expect(scoreEase(readme("dsh plugin --profile web remove example-plugin"), false)).toBe(80);
  });
});
describe("model configuration requirements", () => {
  it.each(["填写模型名、接口地址和 API Key", "Set OPENAI_API_KEY before generating", "Enter your API key in Settings"])("recognizes %s", text => {
    expect(detectNeedsConfig(text)).toBe(true);
  });
  it.each(["无需 API Key。", "No API key required.", "Without an API key", "不需要 OPENAI_API_KEY"])("ignores negated key mentions: %s", text => {
    expect(detectNeedsConfig(text)).toBe(false);
  });
  it("keeps requirements when another step is key-free", () => {
    expect(detectNeedsConfig("安装无需 API Key；生成需要配置 API Key。")).toBe(true);
    expect(detectNeedsConfig("No API key for installation, but provide an API key for generation.")).toBe(true);
  });
});
