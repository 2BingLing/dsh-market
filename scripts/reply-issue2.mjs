/**
 * 回复 issue #2（不关闭）——修正安装命令
 */
import { readFileSync } from "node:fs";

const token = readFileSync(".env", "utf8").match(/^GITHUB_TOKEN=(.+)$/m)?.[1];

const body = [
  "**@HaveCake** 已修复，感谢反馈！三个包已发布到 npm ✅",
  "",
  "**已发布**：",
  "- `@dsh-market/schema@0.1.0`（共享类型）",
  "- `@dsh-market/core@0.1.0`（核心层：数据/搜索/推荐/安装）",
  "- `@dsh-market/plugin@0.1.0`（cordis 侧边栏插件）",
  "",
  "**安装方式已修正**（官方 npx 形态，README 中英文已同步更新）：",
  "",
  "```bash",
  "npx @deepseek-ai/dsh plugin --profile web add @dsh-market/plugin",
  "```",
  "",
  "> 已配置全局 `dsh` 命令的环境可直接 `dsh plugin --profile web add @dsh-market/plugin`（两者等价，`npx @deepseek-ai/dsh` 是官方标准形态）。",
  "",
  "装完重启 harness，侧边栏底部出现「插件市场」入口。",
].join("\n");

async function main() {
  const r = await fetch("https://api.github.com/repos/2BingLing/dsh-market/issues/2/comments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "dsh-market-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  console.log("comment status:", r.status);
  const j = await r.json();
  console.log("comment id:", j.id);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
