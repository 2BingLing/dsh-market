/** 复现搜索问题（node scripts/debug-search.mjs） */
import { readFileSync } from "node:fs";
import Fuse from "fuse.js";

const data = JSON.parse(readFileSync("web/public/plugins.json", "utf8"));
const plugins = data.plugins;
console.log("插件总数:", plugins.length);

// 复现当前 Fuse 配置
const fuse = new Fuse(plugins, {
  keys: [
    { name: "name", weight: 0.4 },
    { name: "description", weight: 0.25 },
    { name: "descriptionZh", weight: 0.25 },
    { name: "tags", weight: 0.1 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
});

// 测试：照名字精确搜
const tests = ["context-doctor", "billion-context-dsh", "dsh-101", "dsh-toolkit", "dsh-deepresearch", "dsh"];
for (const q of tests) {
  const t0 = performance.now();
  const r = fuse.search(q);
  const ms = Math.round(performance.now() - t0);
  console.log(`"${q}" => ${r.length ? r[0].item.name : "未找到!"} (${ms}ms, ${r.length} 条)`);
}

// 对比：简单 substring 匹配（name 精确包含）
console.log("\n--- 对照：name 包含匹配 ---");
for (const q of ["context-doctor", "dsh-101", "dsh-toolkit"]) {
  const hits = plugins.filter((p) => p.name.includes(q));
  console.log(`"${q}" => ${hits.length ? hits.map((h) => h.name).join(",") : "未找到!"} (${hits.length} 条)`);
}
