import { describe, expect, it } from "vitest";
import { scoreEase, generateExplanation } from "../src/scoring.js";
import { detectNeedsConfig, detectUsageNeedsConfig } from "../src/detect.js";

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
describe("usage vs installation configuration (#137 point 3)", () => {
  it.each([
    "生成前需填写模型名、接口地址和 API Key",
    "Set OPENAI_API_KEY before generating",
    "调用模型需要配置 API Key",
  ])("recognizes usage/model context: %s", text => {
    expect(detectUsageNeedsConfig(text)).toBe(true);
  });
  it("ignores keys scoped to installation only", () => {
    const readme = "安装时需设置 GITHUB_TOKEN 以拉取依赖。安装无需 API Key。";
    expect(detectUsageNeedsConfig(readme)).toBe(false);
    expect(detectNeedsConfig(readme)).toBe(true);
  });
  it("treats ambiguous key mentions as usage (conservative)", () => {
    expect(detectUsageNeedsConfig("需要设置 STRIPE_API_KEY。")).toBe(true);
  });
  it("returns false without any key mention", () => {
    expect(detectUsageNeedsConfig("安装即用，无需任何配置。")).toBe(false);
    expect(detectUsageNeedsConfig(null)).toBe(false);
  });
});
describe("explanation distinguishes installation and usage prerequisites", () => {
  // practical/popularity/signal 压到 70 以下：理由截取 slice(0,3)，确保 ease 理由进入前两条
  const breakdown = { maintain: 80, practical: 60, popularity: 50, ease: 100, signal: 40 };
  const pushedAt = new Date().toISOString();
  it("claims out-of-the-box only when nothing needs config", () => {
    const s = generateExplanation(breakdown, 10, pushedAt, { needsConfig: false, usageNeedsConfig: false });
    expect(s).toContain("开箱即用");
    expect(s).not.toContain("使用需配置模型");
  });
  it("mentions model configuration for install-ready but usage-paid plugins", () => {
    const s = generateExplanation(breakdown, 10, pushedAt, { needsConfig: false, usageNeedsConfig: true });
    expect(s).toContain("安装开箱即用");
    expect(s).toContain("使用需配置模型");
    expect(s).not.toContain("无需额外配置即可安装，开箱即用");
  });
  it("never claims out-of-the-box when installation needs config", () => {
    const s = generateExplanation(breakdown, 10, pushedAt, { needsConfig: true, usageNeedsConfig: true });
    expect(s).not.toContain("开箱即用");
    expect(s).toContain("安装步骤清晰");
  });
});
