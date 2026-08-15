/**
 * 合成 README 横幅：生图左侧（hen.png）+ 右侧 SVG 文字层
 * 用法：
 *   node scripts/compose-banner.mjs        # 中文 → banner.png + banner.webp
 *   node scripts/compose-banner.mjs en     # 英文 → banner-en.png + banner-en.webp
 * 输出 1200×600 标准尺寸（png + webp 同时导出，供 README 直接引用 webp）
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = "assets/readme/hen.png";
const W = 1200;
const H = 600;

// 左侧生图区占 55%，右侧文字区从 x=660 起
const TEXT_X = 660;
const TEXT_W = W - TEXT_X - 56; // 右侧可用宽 ~484

const LANG = process.argv[2] === "en" ? "en" : "zh";

// XML 转义（文案中的 & < > 会破坏 SVG 解析）
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const COPY = {
  zh: {
    out: "assets/readme/banner",
    subPre: "DeepSeek Harness 插件市场 · 持续收录 ",
    subPost: " 个插件",
    subSize: 21,
    block: "DSH 插件版 · 装进侧边栏",
    feat1: "一键安装 · 猜你喜欢 · 场景推荐",
    feat2: "已装管理 · GitHub 加星 · AI 代理安装",
    mono: "零 token 被动运行 · 不参与日常对话",
    btn1: "Web 在线体验",
    btn1w: 112,
    btn2: "dsh plugin add",
    btn2w: 132,
    note: "Web 版与插件版仅共享 plugins.json 数据，互不依赖",
  },
  en: {
    out: "assets/readme/banner-en",
    // 英文整串（全 ASCII，workflow 直接生成无字体问题）；数字由 sync-count 更新
    sub: "DeepSeek Harness plugin market · 1481+ plugins daily",
    subSize: 18,
    block: "DSH Plugin · in your sidebar",
    feat1: "One-click install · Recommendations · Scene-aware",
    feat2: "Installed mgmt · GitHub stars · AI-assisted install",
    mono: "Zero-token passive · not in your chat loop",
    btn1: "Live Demo",
    btn1w: 100,
    btn2: "dsh plugin add",
    btn2w: 132,
    note: "Web & plugin share only the plugins.json data — independent",
  },
}[LANG];

/**
 * 数字叠加：workflow 部署时把 ASCII 数字叠加到占位区（Ubuntu 可渲染数字，无需中文字体）
 * 本地直接跑 count 参数时也走同一逻辑（生成完整带数字 banner）
 */
const COUNT_ARG = process.argv.find((a) => a.startsWith("--count="));
const COUNT = COUNT_ARG ? COUNT_ARG.split("=")[1] : null;

// 字体栈：Noto Sans CJK SC 用于 Linux runner（workflow 合成），Windows 回退雅黑/苹方
const FONT_CJK =
  "'Noto Sans CJK SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const FONT_MONO = "ui-monospace, 'Noto Sans Mono CJK SC', SFMono-Regular, Menlo, Consolas, monospace";

// 数字占位区位置：通过测量 subPre 文本实际渲染宽度精确计算（不再手工估算）

async function measureTextWidth(text, size, weight = "500") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="80" viewBox="0 0 2000 80">
  <text x="0" y="40" font-family="${FONT_CJK}" font-size="${size}" font-weight="${weight}" fill="#000">${xml(text)}</text>
</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // 找最右非透明像素
  let maxX = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = info.width - 1; x >= maxX; x--) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        if (x > maxX) maxX = x;
        break;
      }
    }
  }
  return maxX;
}

// 中文数字间隙：subPre 渲染宽度 + 2px 间距（数字紧贴「持续收录」）；数字区宽度容纳 4-5 位
// 英文整串渲染不需要测量
const subPreW = LANG === "en" ? 0 : await measureTextWidth(COPY.subPre, COPY.subSize);
const NUM_GAP_START = TEXT_X + subPreW + 2;
const NUM_GAP_W = 52;

// 数字垂直：与中文基线基本平齐（数字字形略高，+1 微调）
const NUM_Y = 192;
const numCenter = NUM_GAP_START + NUM_GAP_W / 2;
const subMiddle =
  COUNT !== null
    ? `<text x="${numCenter}" y="${NUM_Y + 1}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="600" fill="#101418" text-anchor="middle">${COUNT}</text>`
    : `<rect x="${NUM_GAP_START - 2}" y="${NUM_Y - COPY.subSize + 6}" width="${NUM_GAP_W}" height="${COPY.subSize + 4}" rx="4" fill="#F6F7FC"/>`;

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
  <text x="${TEXT_X}" y="150" font-family="${FONT_CJK}" font-size="58" font-weight="800" letter-spacing="-1" fill="#101418">DSH <tspan fill="url(#brandGrad)">Market</tspan></text>
  <!-- 副标题：中文三段式（前段本地渲染 + 数字 overlay），英文整串（全 ASCII） -->
  ${
    LANG === "en"
      ? `<text x="${TEXT_X}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="500" fill="#59636E">${xml(COPY.sub)}</text>`
      : `<text x="${TEXT_X}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="500" fill="#59636E">${xml(COPY.subPre)}</text>
  ${subMiddle}
  <text x="${NUM_GAP_START + NUM_GAP_W}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="500" fill="#59636E">${xml(COPY.subPost)}</text>`
  }

  <!-- 分隔线 -->
  <line x1="${TEXT_X}" y1="218" x2="${TEXT_X + TEXT_W}" y2="218" stroke="#D9E4F0" stroke-width="2"/>

  <!-- 插件版重点区块 -->
  <text x="${TEXT_X}" y="262" font-family="${FONT_CJK}" font-size="19" font-weight="700" fill="#252525">${xml(COPY.block)}</text>
  <text x="${TEXT_X}" y="296" font-family="${FONT_CJK}" font-size="16" fill="#3A4046">${xml(COPY.feat1)}</text>
  <text x="${TEXT_X}" y="324" font-family="${FONT_CJK}" font-size="16" fill="#3A4046">${xml(COPY.feat2)}</text>
  <text x="${TEXT_X}" y="352" font-family="${FONT_MONO}" font-size="14" fill="#8CA3BB">${xml(COPY.mono)}</text>

  <!-- 徽章行 -->
  <g transform="translate(${TEXT_X} 388)">
    <a href="https://dsh.market/">
      <rect x="0" y="0" width="${COPY.btn1w}" height="34" rx="17" fill="url(#brandGrad)"/>
      <text x="${COPY.btn1w / 2}" y="22" font-family="${FONT_CJK}" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">${COPY.btn1}</text>
    </a>
    <a href="https://github.com/2BingLing/dsh-market">
      <rect x="${COPY.btn1w + 12}" y="0" width="${COPY.btn2w}" height="34" rx="17" fill="#252525"/>
      <text x="${COPY.btn1w + 12 + COPY.btn2w / 2}" y="22" font-family="${FONT_CJK}" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">${COPY.btn2}</text>
    </a>
  </g>

  <!-- 关系说明 -->
  <text x="${TEXT_X}" y="470" font-family="${FONT_CJK}" font-size="13.5" fill="#8A919F">${xml(COPY.note)}</text>
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

// 3. 合成 png
const outPng = `${COPY.out}.png`;
await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 246, g: 247, b: 252, alpha: 1 } },
})
  .composite([
    { input: leftCrop, left: 0, top: 0 },
    { input: textLayer, left: 0, top: 0 },
  ])
  .png()
  .toFile(outPng);

// 4. 导出 webp（README 引用轻量格式）
const outWebp = `${COPY.out}.webp`;
await sharp(outPng).webp({ quality: 80 }).toFile(outWebp);

if (COUNT === null && LANG === "zh") {
  // 中文 base 版：额外输出 banner-base-zh.webp + 数字位置文件（供 overlay-count.mjs 叠加）
  // 英文整串渲染，无需 base/overlay
  const baseWebp = `assets/readme/banner-base-${LANG}.webp`;
  await sharp(outPng).webp({ quality: 80 }).toFile(baseWebp);
  const posFile = `assets/readme/banner-count-pos-${LANG}.json`;
  writeFileSync(
    posFile,
    JSON.stringify({
      x: NUM_GAP_START,
      y: NUM_Y,
      size: COPY.subSize,
      w: NUM_GAP_W,
      font: "sans-serif",
    }, null, 2),
    "utf8"
  );
  console.log(`saved: ${outPng}, ${outWebp}, ${baseWebp}, ${posFile}`);
} else {
  console.log(`saved: ${outPng}, ${outWebp} (count=${COUNT})`);
}
