/**
 * 合成 README 横幅：生图左侧（hen.png）+ 右侧 SVG 文字层
 * 用法：
 *   node scripts/compose-banner.mjs        # 中文 → banner.png + banner.webp
 *   node scripts/compose-banner.mjs en     # 英文 → banner-en.png + banner-en.webp
 * 输出 1200×600 标准尺寸（png + webp 同时导出，供 README 直接引用 webp）
 */
import sharp from "sharp";

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
    subPre: "DeepSeek Harness plugin market · ",
    subPost: "+ plugins daily",
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

// 数字占位区位置（副标题 y=192，subPre 文字之后）：
// 中文 subPre 约 15 字 × 21px ≈ 315px；英文约 40 字符 × 9px ≈ 360px。
// 用固定间隙 + 数字居中叠加。实测对齐后微调。
const NUM_Y = 192;
const NUM_GAP_START = LANG === "en" ? TEXT_X + 372 : TEXT_X + 316;
const NUM_GAP_W = 120; // 数字区宽度（容纳 5 位数字）

// 副标题：subPre + （占位块或数字）+ subPost
// 占位块用背景同色矩形（本地 base 版），workflow 叠加数字时覆盖它
const subMiddle =
  COUNT !== null
    ? `<text x="${NUM_GAP_START}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="600" fill="#101418">${COUNT}</text>`
    : `<rect x="${NUM_GAP_START - 4}" y="${NUM_Y - COPY.subSize + 6}" width="${NUM_GAP_W}" height="${COPY.subSize + 4}" rx="4" fill="#F6F7FC"/>`;

// 字体栈：Noto Sans CJK SC 用于 Linux runner（workflow 合成），Windows 回退雅黑/苹方
const FONT_CJK =
  "'Noto Sans CJK SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const FONT_MONO = "ui-monospace, 'Noto Sans Mono CJK SC', SFMono-Regular, Menlo, Consolas, monospace";

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
  <!-- 副标题三段式：前段中文（本地渲染）+ 数字（workflow 叠加 ASCII）+ 后段 -->
  <text x="${TEXT_X}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="500" fill="#59636E">${xml(COPY.subPre)}</text>
  ${subMiddle}
  <text x="${NUM_GAP_START + NUM_GAP_W}" y="${NUM_Y}" font-family="${FONT_CJK}" font-size="${COPY.subSize}" font-weight="500" fill="#59636E">${xml(COPY.subPost)}</text>

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

// 4. 同步导出 webp（README 引用轻量格式）
const outWebp = `${COPY.out}.webp`;
await sharp(outPng).webp({ quality: 80 }).toFile(outWebp);

console.log("saved:", outPng, "and", outWebp);
