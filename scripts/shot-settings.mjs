/**
 * 交互截图：打开 DSH web → 点击侧边栏底部设置按钮 → 截取设置弹窗
 * 用法：node scripts/shot-settings.mjs <out.png> [width] [height]
 */
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "design-ref/shots/dsh-settings.png";
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 1000);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://127.0.0.1:3080", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3500);
  // 找侧边栏底部设置按钮（按钮 title/aria-label 含"设置"）
  const candidates = [
    'button[title*="设置"]',
    'button[aria-label*="设置"]',
    'button:has-text("设置")',
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
  if (!clicked) {
    // 兜底：侧边栏底部找按钮
    const bottom = page.locator("nav button, aside button").last();
    if ((await bottom.count()) > 0) {
      await bottom.click({ timeout: 5000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  console.log(`saved: ${out} (settings clicked: ${clicked})`);
} finally {
  await browser.close();
}
