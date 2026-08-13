/**
 * 三方向初稿评审：gpt-5.6-luna 视觉评审
 * 用法：node scripts/vision-review.mjs
 * 输入：design-ref/shots/A-deepsea.png B-quiet.png C-archive.png
 * 输出：design-ref/review.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const cfg = JSON.parse(
  readFileSync(join(process.env.USERPROFILE, ".config", "opencode", "opencode.json"), "utf-8")
);
const apiKey = cfg.provider.cctq.options.apiKey;
const baseURL = cfg.provider.cctq.options.baseURL;

async function toDataUrl(p) {
  const buf = await sharp(join(root, p)).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const shots = [
  { path: "design-ref/shots/A-deepsea.png", label: "方向A DeepSea 深海静谧" },
  { path: "design-ref/shots/B-quiet.png", label: "方向B Quiet Lab 静默实验室" },
  { path: "design-ref/shots/C-archive.png", label: "方向C Open Archive 开放档案馆" },
];

const prompt = `你是资深 UI/UX 设计总监。这是 DeepSeek Harness 插件市场（DSH Market）的三个设计方向初稿（A/B/C 三张截图，均为同一页面的不同视觉诠释，页面内容是：顶部导航+搜索筛选+插件卡片列表+实用五维评分展示）。

请评审：
1. 每版分别打分（满分10）：品牌契合（DeepSeek 蓝系/克制理性气质）、信息层级、排版细节、组件品质、整体完成度
2. 每版的 2 个最亮眼优点 + 2 个最明显问题
3. 三版横向对比表
4. 你的推荐：选哪版作为骨架，哪些元素从其他版借鉴（例如"B 的布局 + A 的精选卡 + C 的档案感"）
5. 指出 3 个跨版本共通的细节问题（比如评分条可读性、标签密度、卡片信息过载、对比度等）
输出中文 markdown。`;

const imageParts = [];
for (const s of shots) {
  imageParts.push({ type: "text", text: `【${s.label}】` });
  imageParts.push({ type: "image_url", image_url: { url: await toDataUrl(s.path) } });
}

const body = {
  model: "gpt-5.6-luna",
  messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...imageParts] }],
  max_tokens: 6000,
};

console.log("calling gpt-5.6-luna for design review...");
let data = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (res.ok) { data = await res.json(); break; }
  const err = (await res.text()).slice(0, 200);
  console.warn(`  attempt ${attempt} failed: ${err}`);
  if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
}
if (!data) { console.error("review failed"); process.exit(1); }

const review = data.choices?.[0]?.message?.content ?? "";
writeFileSync(join(root, "design-ref", "review.md"), `# DSH Market 三方向初稿评审（gpt-5.6-luna）\n\n${review}\n`, "utf-8");
console.log(`saved: design-ref/review.md (${review.length} chars)`);
