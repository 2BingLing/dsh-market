/**
 * 交互截图：打开 DSH web → 点击侧边栏底部「插件市场」按钮 → 截取面板
 * 用法：node scripts/shot-market.mjs <out.png> [width] [height]
 */
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "design-ref/shots/market-panel.png";
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 1000);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://127.0.0.1:3080", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3500);
  const candidates = [
    'button[aria-label="插件市场"]',
    'button[title="插件市场"]',
    'button:has-text("插件市场")',
  ];
  let clicked = false;
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) {
      await el.click({ timeout: 5000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  console.log(`saved: ${out} (market clicked: ${clicked})`);
} finally {
  await browser.close();
}
