/**
 * 把收录数字叠加到 banner base 图（部署时 workflow 调用）
 *
 * 原理：banner-base.webp 由本地生成（中文渲染正常），副标题数字位置留空（同色占位）。
 * 本脚本用 sharp 渲染纯 ASCII 数字（Ubuntu 默认字体即可，无需中文字体）叠加到占位区，
 * 输出最终 banner.webp —— 图片内显示「持续收录 N 个插件」。
 *
 * 用法：node scripts/overlay-count.mjs zh 1481   # → assets/readme/banner.webp
 *       node scripts/overlay-count.mjs en 1481   # → assets/readme/banner-en.webp
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANG = process.argv[2] === "en" ? "en" : "zh";
const COUNT = process.argv[3];
if (!COUNT) {
  console.error("用法: node scripts/overlay-count.mjs <zh|en> <count>");
  process.exit(1);
}

// 与 compose-banner.mjs 保持一致的参数（base 生成时写入了位置文件）
const POS_FILE = path.join(root, "assets/readme", `banner-count-pos-${LANG}.json`);
let pos;
try {
  pos = JSON.parse(readFileSync(POS_FILE, "utf8"));
} catch {
  console.error(`缺少位置文件 ${POS_FILE}（先用 compose-banner.mjs 生成 base）`);
  process.exit(1);
}

const BASE = path.join(root, "assets/readme", `banner-base-${LANG}.webp`);
const OUT = path.join(root, "assets/readme", LANG === "en" ? "banner-en.webp" : "banner.webp");

const { x, y, size, font } = pos;

// 数字文本 SVG（纯 ASCII，Ubuntu 可渲染；字体用 DejaVu 兜底）
const numSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${size + 12}" viewBox="0 0 400 ${size + 12}">
  <text x="200" y="${size}" font-family="${font}, DejaVu Sans, sans-serif" font-size="${size}" font-weight="600" fill="#101418" text-anchor="middle">${COUNT}</text>
</svg>`;

const numLayer = await sharp(Buffer.from(numSvg)).png().toBuffer();

// 叠加到 base 图（占位区位置）：数字与中文基线平齐（top 上移 4px），并微左移 2px
await sharp(BASE)
  .composite([{ input: numLayer, left: Math.round(x - 200 + (pos.w ?? 52) / 2 - 2), top: Math.round(y - size - 4) }])
  .webp({ quality: 80 })
  .toFile(OUT);
console.log(`overlay-count: ${COUNT} → ${OUT}`);
