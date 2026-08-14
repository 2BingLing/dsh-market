/**
 * 真实数据端到端验证脚本（开发调试用）：
 * 本地数据 → 扫描真实已装 → 画像 → 推荐 / 搜索 / 场景推荐
 * 运行：node --import tsx plugin/core/scripts/e2e-demo.ts
 */
import { resolveConfig, readProfile, writeProfile } from "../src/config.js";
import { fetchMarketData } from "../src/data.js";
import { scanInstalled } from "../src/installed.js";
import { updateProfile, topTags } from "../src/profile.js";
import { recommend } from "../src/recommend.js";
import { search } from "../src/search.js";
import { join } from "node:path";
import { homedir } from "node:os";

async function main() {
  const cfg = resolveConfig({
    dataSource: { localPath: join(process.cwd(), "data", "plugins.json") },
  });
  console.log("=== 配置 ===");
  console.log("skillsDir:", cfg.skillsDir);
  console.log("profilesDir:", cfg.profilesDir);
  console.log("dataDir:", cfg.dataDir);

  // 1. 数据
  const { data, source } = await fetchMarketData(cfg);
  console.log(`\n=== 数据（${source}）===\n插件数: ${data.plugins.length}, 生成时间: ${data.generatedAt}`);
  const byType: Record<string, number> = {};
  for (const p of data.plugins) byType[p.type] = (byType[p.type] ?? 0) + 1;
  console.log("类型分布:", JSON.stringify(byType));

  // 2. 已装扫描
  const installed = scanInstalled(cfg, data);
  const matched = installed.filter((i) => i.pluginId);
  console.log(`\n=== 已装扫描 ===\n共 ${installed.length} 项，命中收录 ${matched.length} 项`);
  for (const m of matched.slice(0, 15)) {
    console.log(`  - ${m.localName} → ${m.pluginId} (${m.source})`);
  }

  // 3. 画像
  const prev = readProfile(cfg);
  const profile = updateProfile(prev, data.plugins, { installed });
  writeProfile(cfg, profile);
  console.log(`\n=== 画像 ===\n置信度: ${profile.confidence.toFixed(2)}`);
  console.log("top 标签:", topTags(profile, 15).join(", "));
  console.log("已装来源数:", profile.sources.installed.length, "加星来源数:", profile.sources.starred.length);

  // 4. 推荐（含场景）
  const exclude = matched.map((m) => m.pluginId!);
  const recs = recommend(data.plugins, profile, {
    excludeIds: exclude,
    sceneTags: ["飞书", "文档管理", "办公效率", "笔记"],
    limit: 15,
  });
  console.log(`\n=== 推荐（排除已装 ${exclude.length}）===\n阶段: ${profile.confidence >= 0.4 ? "veteran" : "novice"}（置信度 ${profile.confidence.toFixed(2)}）`);
  for (const r of recs.slice(0, 12)) {
    console.log(`  [${r.origin}] ${r.plugin.name} (${r.plugin.score.total}分) ${r.plugin.descriptionZh ?? ""}`);
    console.log(`      理由: ${r.reasons.join("；")}`);
  }

  // 5. 搜索
  console.log("\n=== 搜索「飞书文档」===");
  const hits = search(data.plugins, "飞书", { limit: 5 });
  for (const h of hits) {
    console.log(`  ${h.plugin.name} (${h.plugin.fullName}) ${h.plugin.descriptionZh ?? ""}`);
  }
  console.log("\n=== 语义搜索示例（tags: 自动化）===");
  const semantic = search(data.plugins, "", { semanticTags: ["自动化", "浏览器"], limit: 5 });
  for (const h of semantic) {
    console.log(`  ${h.plugin.name} tagHits=${h.tagHits} ${h.plugin.tags.filter(t => /[\u4e00-\u9fff]/.test(t)).join(",")}`);
  }
}

main().catch((err) => {
  console.error("E2E demo failed:", err);
  process.exit(1);
});
