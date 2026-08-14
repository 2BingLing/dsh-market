/**
 * 合成 README 横幅：生图左侧（hen.png）+ 右侧 SVG 文字层
 * 输出 assets/readme/banner.png（1200×600 标准尺寸）
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const SRC = "assets/readme/hen.png";
const OUT = "assets/readme/banner.png";
const W = 1200;
const H = 600;

// 左侧生图区占 55%，右侧文字区从 x=660 起
const TEXT_X = 660;
const TEXT_W = 1200 - TEXT_X - 56; // 右侧可用宽 ~484

// 文字层 SVG（与生图右侧背景 #F6F7FC 协调；文字深炭/品牌蓝）
const textSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4C7FC4"/>
      <stop offset="1" stop-color="#173F73"/>
    </linearGradient>
  </defs>
  <!-- 标题 -->
  <text x="${TEXT_X}" y="150" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="58" font-weight="800" letter-spacing="-1" fill="#101418">DSH <tspan fill="url(#brandGrad)">Market</tspan></text>
  <text x="${TEXT_X}" y="192" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="21" font-weight="500" fill="#59636E">DeepSeek Harness 插件市场 · 持续收录 536 个插件</text>

  <!-- 分隔线 -->
  <line x1="${TEXT_X}" y1="218" x2="${TEXT_X + TEXT_W}" y2="218" stroke="#D9E4F0" stroke-width="2"/>

  <!-- 插件版重点区块 -->
  <text x="${TEXT_X}" y="262" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="19" font-weight="700" fill="#252525">DSH 插件版 · 装进侧边栏</text>
  <text x="${TEXT_X}" y="296" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="16" fill="#3A4046">一键安装 · 猜你喜欢 · 场景推荐</text>
  <text x="${TEXT_X}" y="324" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="16" fill="#3A4046">已装管理 · GitHub 加星 · AI 代理安装</text>
  <text x="${TEXT_X}" y="352" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" fill="#8CA3BB">零 token 被动运行 · 不参与日常对话</text>

  <!-- 徽章行 -->
  <g transform="translate(${TEXT_X} 388)">
    <a href="https://2bingling.github.io/dsh-market/">
      <rect x="0" y="0" width="112" height="34" rx="17" fill="url(#brandGrad)"/>
      <text x="56" y="22" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">Web 在线体验</text>
    </a>
    <a href="https://github.com/2BingLing/dsh-market">
      <rect x="124" y="0" width="132" height="34" rx="17" fill="#252525"/>
      <text x="190" y="22" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">dsh plugin add</text>
    </a>
  </g>

  <!-- 关系说明 -->
  <text x="${TEXT_X}" y="470" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="13.5" fill="#8A919F">Web 版与插件版仅共享 plugins.json 数据，互不依赖</text>
</svg>
`;

// 1. 生图缩放到左侧区（0-660 覆盖 1200 宽中的 0-655，保持 2:1 → 高 600）
//    生图 1774x887 → 裁左 55% → 975x887 → 缩到 656x600
const leftCrop = await sharp(SRC)
  .extract({ left: 0, top: 0, width: Math.round(1774 * 0.55), height: 887 })
  .resize(656, 600, { fit: "fill" })
  .png()
  .toBuffer();

// 2. 文字层 SVG → PNG
const textLayer = await sharp(Buffer.from(textSvg))
  .png()
  .toBuffer();

// 3. 合成
await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 246, g: 247, b: 252, alpha: 1 } },
})
  .composite([
    { input: leftCrop, left: 0, top: 0 },
    { input: textLayer, left: 0, top: 0 },
  ])
  .png()
  .toFile(OUT);

console.log("saved:", OUT);
