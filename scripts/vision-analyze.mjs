/**
 * 视觉分析：调用 gpt-5.6-luna（cctq.ai，OpenAI 兼容）分析设计截图
 * 用法：node scripts/vision-analyze.mjs
 * 输入：design-ref/*.png（基准截图）
 * 输出：design-ref/style-analysis.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// 从 opencode 配置读取 cctq provider 的 key
const opencodeCfg = JSON.parse(
  readFileSync(join(process.env.USERPROFILE, ".config", "opencode", "opencode.json"), "utf-8")
);
const apiKey = opencodeCfg.provider.cctq.options.apiKey;
const baseURL = opencodeCfg.provider.cctq.options.baseURL;
const model = "gpt-5.6-luna";

/** 压缩为 900px 宽 JPEG 再转 base64（控制请求体积） */
async function toDataUrl(p) {
  const buf = await sharp(join(root, p))
    .resize({ width: 900, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const shots = [
  { path: "design-ref/dsh-web-ui.png", label: "DeepSeek Harness Web UI（本地运行的真实界面）" },
  { path: "design-ref/deepseek-home.png", label: "DeepSeek 官网首页 deepseek.com" },
];

const prompt = `你是资深 UI/UX 设计总监。请仔细分析以下两张截图（DeepSeek Harness Web UI、DeepSeek 官网），然后：

1. 对每张截图给出视觉风格分析：主色/辅色（精确 hex）、背景色、文字色、字体气质、布局结构、组件风格（卡片/按钮/侧边栏/导航）、圆角/阴影/边框特征、整体气质词（3-5 个）
2. 提炼 DeepSeek 设计语言（DSH Market 要继承的核心）：给出完整色板（hex）、推荐的字体栈（中英文）、布局模式、组件样式建议（按钮/卡片/标签/评分条/搜索框）、暗色/亮色模式特征
3. 基于以上，在"DeepSeek 风格语境内"给出 3 个差异化设计方向（每方向：命名、一句话定位、与另两版的差异点、主导色变体、版式特征）
输出用中文，结构化 markdown，色值必须精确。`;

// 先压缩所有截图（async 收集）
const imageParts = [];
for (const s of shots) {
  imageParts.push({ type: "text", text: `【截图 ${s.label}】` });
  imageParts.push({ type: "image_url", image_url: { url: await toDataUrl(s.path) } });
}

const body = {
  model,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...imageParts,
      ],
    },
  ],
  max_tokens: 8000,
};

console.log("calling gpt-5.6-luna for style analysis...");

// cctq.ai 中转渠道偶发调度失败，退避重试
let data = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    data = await res.json();
    break;
  }
  const errText = (await res.text()).slice(0, 300);
  console.warn(`  attempt ${attempt} failed (${res.status}): ${errText}`);
  if (attempt < 3) {
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}

if (!data) {
  console.error("vision analysis failed after retries");
  process.exit(1);
}
const analysis = data.choices?.[0]?.message?.content ?? "";
const outPath = join(root, "design-ref", "style-analysis.md");
writeFileSync(outPath, `# DSH Market 视觉风格分析（gpt-5.6-luna 输出）\n\n${analysis}\n`, "utf-8");
console.log(`saved: ${outPath} (${analysis.length} chars)`);
