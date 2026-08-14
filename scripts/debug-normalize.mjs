/** 调试标签归一化 LLM 输出（node scripts/debug-normalize.mjs） */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/plugins.json", "utf8"));
const counts = {};
for (const p of data.plugins) {
  for (const t of p.tags) {
    if (/[\u4e00-\u9fff]/.test(t)) counts[t] = (counts[t] ?? 0) + 1;
  }
}
const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 120);
const prompt = [
  "你是 DSH 插件市场的标签管理员。以下是当前插件聚合出的中文功能标签（格式：标签名 使用次数）。",
  "请找出【同义或近义】的标签并合并：",
  '1. 只输出需要合并的映射，格式：{"被合并的标签": "保留的主标签"}',
  "2. 主标签选更通用、更常用、表达更准确的",
  '3. 例：{"AI增强": "AI 增强"}、{"网页自动化": "浏览器自动化"}',
  "4. 含义不同的标签绝对不要合并",
  "5. 没有把握就不合并",
  "",
  "标签清单：",
  entries.map(([t, n]) => `${t} ${n}`).join("\n"),
  "",
  "只输出 JSON，不要任何其他文字。",
].join("\n");

const key = readFileSync(".env", "utf8").match(/DEEPSEEK_API_KEY=(\S+)/)[1];
const res = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 800,
  }),
});
const d = await res.json();
const content = d.choices?.[0]?.message?.content ?? "";
console.log("=== LLM 原始输出 ===");
console.log(content);
