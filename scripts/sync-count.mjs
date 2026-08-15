/**
 * 同步实时收录数量到 README 静态资产
 *
 * 读取 data/plugins.json 的 plugins 数量，更新：
 *   - scripts/compose-banner.mjs  "持续收录 NNN 个插件"（banner 文案源）
 *   - README.md                   "当前 NNN 个"
 *   - assets/readme/hero.svg      "持续收录 NNN+ 插件"（备用 SVG hero）
 * 只在数量变化时写文件（避免无谓提交）。
 *
 * 用法：node scripts/sync-count.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginData = JSON.parse(readFileSync(path.join(root, "data/plugins.json"), "utf8"));
const count = Array.isArray(pluginData.plugins) ? pluginData.plugins.length : 0;
if (!count) {
  console.error("sync-count: plugins.json 中没有 plugins 数组，跳过");
  process.exit(1);
}

const targets = [
  {
    file: "README.md",
    re: /当前 \d+ 个/,
    to: `当前 ${count} 个`,
  },
  {
    file: "README.en.md",
    re: /currently \d+/,
    to: `currently ${count}`,
  },
  {
    file: "assets/readme/hero.svg",
    re: /持续收录 \d+\+ 插件/,
    to: `持续收录 ${count}+ 插件`,
  },
];

let changed = false;
for (const t of targets) {
  const p = path.join(root, t.file);
  const text = readFileSync(p, "utf8");
  if (!t.re.test(text)) {
    console.warn(`sync-count: ${t.file} 未匹配 ${t.re}，跳过`);
    continue;
  }
  const next = text.replace(t.re, t.to);
  if (next !== text) {
    writeFileSync(p, next, "utf8");
    changed = true;
    console.log(`sync-count: ${t.file} → ${t.to}`);
  }
}

console.log(changed ? "sync-count: 已完成同步" : "sync-count: 数量无变化，无需提交");
