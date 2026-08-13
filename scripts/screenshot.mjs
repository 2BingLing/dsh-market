/**
 * 截图工具：用系统 Edge（playwright-core channel: msedge）截取指定 URL
 * 用法：node scripts/screenshot.mjs <url> <outPath> [width] [height]
 */
import { chromium } from "playwright-core";

const url = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] ?? 1600);
const height = Number(process.argv[5] ?? 1000);

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
  } catch {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  await page.waitForTimeout(3500);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`saved: ${out}`);
} finally {
  await browser.close();
}
