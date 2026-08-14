/** 复现 normalize filter 链路（node scripts/debug-filter.mjs） */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/plugins.json", "utf8"));
const counts = new Map();
for (const p of data.plugins) {
  for (const t of p.tags) {
    if (!/[\u4e00-\u9fff]/.test(t)) continue;
    if (["效率工具", "开发辅助", "AI 增强", "AI增强"].includes(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
}

// 模拟 LLM 实际输出（方向不稳定的那版）
const mockContent = '{"界面美化": "界面增强", "主题皮肤": "主题定制", "网页抓取": "网络爬取"}';
const cleaned = mockContent.replace(/```json/g, "").replace(/```/g, "").trim();
const start = cleaned.indexOf("{");
const end = cleaned.lastIndexOf("}");
console.log("start/end:", start, end);
const parsed = JSON.parse(cleaned.slice(start, end + 1));
console.log("parsed:", JSON.stringify(parsed));
const filtered = Object.fromEntries(
  Object.entries(parsed).filter(([s, t]) => counts.has(s) && t && s !== t)
);
console.log("filtered:", JSON.stringify(filtered));
console.log("counts.has 界面美化:", counts.has("界面美化"), "| 界面增强:", counts.has("界面增强"));
