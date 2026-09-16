/**
 * detectCrossEcosystem 单元测试（#169 E2）：跨生态 skill 检测
 * 规则：仅 skill 型 + Claude 生态强信号（topics/描述/README）+ 描述自述 DSH 的豁免
 * 校准基线：7,333 条真实数据命中 23/128 skill，ruflo 命中，DSH 自述 4 例全部豁免
 */
import { describe, it, expect } from "vitest";
import { detectCrossEcosystem, CLAUDE_ECOSYSTEM_TOPICS } from "../src/detect.js";

const base = {
  description: "A useful skill",
  topics: [] as string[],
  readme: null as string | null,
};

describe("detectCrossEcosystem", () => {
  it("cordis 插件型永不标记（天然 DSH 专属）", () => {
    expect(detectCrossEcosystem({ ...base, type: "cordis-plugin", topics: ["claude-code"] }).cross).toBe(false);
    expect(detectCrossEcosystem({ ...base, type: null, topics: ["claude-code"] }).cross).toBe(false);
  });

  it("ruflo 场景：claude-code topic 命中（自打的 dsh-plugin topic 不参与豁免）", () => {
    const r = detectCrossEcosystem({
      type: "skill",
      description:
        "The original agent harness. Deploy intelligent multi-player swarms… native Claude Code / Codex / Hermes and many more Integrated",
      topics: ["claude-code", "mcp-server", "dsh-plugin"],
      readme: null,
    });
    expect(r.cross).toBe(true);
    expect(r.hint).toContain("DSH 兼容性未经验证");
  });

  it("描述含 Claude Code / Anthropic 也命中（无 topic 依赖）", () => {
    expect(detectCrossEcosystem({ ...base, type: "skill", description: "Precision PPT design skill for OpenCode/Claude Code/Codex" }).cross).toBe(true);
    expect(detectCrossEcosystem({ ...base, type: "skill", description: "Built on the Anthropic API" }).cross).toBe(true);
  });

  it("README 宿主特征命中：~/.claude、claude mcp add", () => {
    expect(detectCrossEcosystem({ ...base, type: "skill", readme: "cp SKILL.md ~/.claude/skills/" }).cross).toBe(true);
    expect(detectCrossEcosystem({ ...base, type: "skill", readme: "run `claude mcp add foo` first" }).cross).toBe(true);
  });

  it("描述自述服务 DSH → 豁免（校准中 4 个 DSH 专属 skill）", () => {
    expect(
      detectCrossEcosystem({
        type: "skill",
        description: "SEO audit skill: full local & technical SEO audit for DSH — built for DeepSeek Harness",
        topics: ["claude-code"],
        readme: null,
      }).cross
    ).toBe(false);
    expect(
      detectCrossEcosystem({
        type: "skill",
        description: "An Agent Skills skill for developing DeepSeek Harness (DSH) plugins",
        topics: [],
        readme: null,
      }).cross
    ).toBe(false);
  });

  it("无任何 Claude 信号 → 不标记", () => {
    expect(detectCrossEcosystem({ ...base, type: "skill" }).cross).toBe(false);
    expect(detectCrossEcosystem({ ...base, type: "skill", description: "一个普通的 DSH 技能" }).cross).toBe(false);
  });

  it("CLAUDE_ECOSYSTEM_TOPICS 导出稳定（topic 全小写匹配）", () => {
    expect(CLAUDE_ECOSYSTEM_TOPICS.has("claude-code")).toBe(true);
    expect(CLAUDE_ECOSYSTEM_TOPICS.has("anthropic")).toBe(true);
  });
});
