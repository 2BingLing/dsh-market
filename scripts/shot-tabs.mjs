/**
 * 截图插件市场各 Tab（搜索/收藏/已装/设置）与安装弹窗
 * 用法：node scripts/shot-tabs.mjs
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  const tabs = ["推荐", "搜索", "收藏", "已装", "设置"];
  for (const t of tabs) {
    // 精确定位面板内 Tab（DSH 主界面也有「设置」按钮，用面板 x 坐标过滤）
    const clickedTab = await page.evaluate((label) => {
      const buttons = [...document.querySelectorAll("button")];
      const b = buttons.find((x) => {
        const r = x.getBoundingClientRect();
        return (x.textContent || "").trim() === label && r.x > 400 && r.width > 0;
      });
      if (b) { b.click(); return true; }
      return false;
    }, t);
    console.log(`click tab ${t}: ${clickedTab}`);
    await page.waitForTimeout(1800);
    const name = { 推荐: "recommend", 搜索: "search", 收藏: "favorites", 已装: "installed", 设置: "settings" }[t];
    await page.screenshot({ path: `design-ref/shots/tab-${name}.png` });
    console.log(`saved tab-${name}.png`);
  }
  // 安装弹窗：切回推荐，点第一张卡片的「安装」
  const recBtn = page.locator(`button:has-text("推荐")`).first();
  await recBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const installBtn = page.locator('button:has-text("安装")').first();
  await installBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "design-ref/shots/tab-install-modal.png" });
  console.log("saved tab-install-modal.png");
} finally {
  await browser.close();
}
