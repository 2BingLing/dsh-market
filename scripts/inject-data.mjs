/**
 * 把真实插件数据注入三个方向初稿 HTML
 * - DATA 注入为数组（模板代码按数组使用）
 * - _genAt 注入为字符串字面量
 * 用法：node scripts/inject-data.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = join(root, "design-ref", "directions");

const data = JSON.parse(readFileSync(join(root, "design-ref", "prototype-data.json"), "utf-8"));
const pluginsJs = JSON.stringify(data.plugins).replace(/</g, "\\u003c");
const genAtJs = JSON.stringify(data.generatedAt.slice(0, 10));

for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const p = join(dir, f);
  let html = readFileSync(p, "utf-8");

  // 若已被注入（const DATA = {...}），先还原占位符
  html = html.replace(/const DATA = \{[\s\S]*?\};/, "const DATA = __PLUGIN_DATA__;");

  if (!html.includes("__PLUGIN_DATA__")) {
    console.log(`skip (no placeholder): ${f}`);
    continue;
  }
  html = html.replace("__PLUGIN_DATA__", pluginsJs);
  html = html.replace(/DATA\._genAt/g, genAtJs);
  writeFileSync(p, html, "utf-8");
  console.log(`injected: ${f} (${(pluginsJs.length / 1024).toFixed(0)}KB data)`);
}
