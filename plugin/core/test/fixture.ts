/**
 * 测试夹具：构造市场数据（中英混合标签、不同分数/类型/时间），供各模块测试复用
 */
import type {
  DshPlugin,
  InstallInfo,
  MarketData,
  PracticalScore,
} from "@dsh-market/schema";

type FixturePartial = Partial<Omit<DshPlugin, "score" | "install">> & {
  id: string;
  name: string;
  score?: Partial<PracticalScore>;
  install?: Partial<InstallInfo>;
};

function p(partial: FixturePartial): DshPlugin {
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86400000).toISOString();
  return {
    id: partial.id,
    type: partial.type ?? "cordis-plugin",
    name: partial.name,
    owner: partial.id.split("/")[0] ?? "owner",
    repo: partial.id.split("/")[1] ?? partial.name,
    fullName: partial.fullName ?? partial.id,
    stars: partial.stars ?? 5,
    forks: 0,
    openIssues: 0,
    language: "TypeScript",
    description: partial.description ?? `${partial.name} description`,
    descriptionZh: partial.descriptionZh ?? null,
    tags: partial.tags ?? [],
    curated: partial.curated ?? false,
    curatedReason: partial.curatedReason,
    homepage: partial.homepage ?? null,
    license: "MIT",
    topics: [],
    pushedAt: partial.pushedAt ?? days(3),
    createdAt: days(30),
    updatedAt: days(3),
    readmeSummary: null,
    install: {
      method: partial.type === "skill" ? "skills-add" : "pnpm-profile",
      needsConfig: partial.install?.needsConfig ?? false,
      commands: partial.install?.commands ?? [],
      target: partial.install?.target,
    },
    score: {
      total: partial.score?.total ?? 50,
      breakdown: {
        maintain: partial.score?.breakdown?.maintain ?? 50,
        practical: partial.score?.breakdown?.practical ?? 50,
        popularity: partial.score?.breakdown?.popularity ?? 50,
        ease: partial.score?.breakdown?.ease ?? 50,
        signal: partial.score?.breakdown?.signal ?? 50,
      },
      confidence: partial.score?.confidence ?? 0.7,
      explanation: partial.score?.explanation ?? "",
    },
    sources: ["fixture"],
    lastCheckedAt: new Date().toISOString(),
  };
}

/** 标准测试市场：12 个插件覆盖多种标签/分数/类型 */
export function makeMarket(): MarketData {
  const plugins: DshPlugin[] = [
    p({ id: "feishu/feishu-doc", name: "feishu-doc", type: "cordis-plugin", tags: ["飞书", "文档管理", "办公效率"], descriptionZh: "读取飞书文档", score: { total: 88 } }),
    p({ id: "feishu/feishu-drive", name: "feishu-drive", type: "cordis-plugin", tags: ["飞书", "云盘", "办公效率"], descriptionZh: "飞书云空间文件管理", score: { total: 82 } }),
    p({ id: "acme/browser-tool", name: "browser-tool", type: "cordis-plugin", tags: ["浏览器", "自动化", "效率工具"], descriptionZh: "浏览器自动化", score: { total: 75 } }),
    p({ id: "acme/web-scraper", name: "web-scraper", type: "skill", tags: ["爬虫", "数据采集", "开发辅助"], descriptionZh: "网页数据采集", score: { total: 60 } }),
    p({ id: "data-org/chart-gen", name: "chart-gen", type: "skill", tags: ["图表", "数据可视化", "办公效率"], descriptionZh: "生成图表", score: { total: 70 }, install: { needsConfig: true } }),
    p({ id: "data-org/report-gen", name: "report-gen", type: "cordis-plugin", tags: ["报告", "办公效率"], descriptionZh: "自动生成报告", score: { total: 55 } }),
    p({ id: "old/legacy-tool", name: "legacy-tool", type: "cordis-plugin", tags: ["遗留", "办公效率"], descriptionZh: "老工具", score: { total: 30 }, pushedAt: new Date(Date.now() - 200 * 86400000).toISOString() }),
    p({ id: "new/hot-plugin", name: "hot-plugin", type: "cordis-plugin", tags: ["新潮", "AI 增强"], descriptionZh: "最新热门插件", score: { total: 92 }, curated: true, curatedReason: "社区精选：AI 增强标杆", pushedAt: new Date(Date.now() - 2 * 86400000).toISOString() }),
    p({ id: "sec/guard", name: "guard", type: "skill", tags: ["安全", "防护"], descriptionZh: "安全扫描", score: { total: 85 }, install: { needsConfig: true } }),
    p({ id: "note/knowledge-base", name: "knowledge-base", type: "cordis-plugin", tags: ["知识库", "笔记", "文档管理"], descriptionZh: "知识库管理", score: { total: 66 } }),
    p({ id: "note/obsidian-sync", name: "obsidian-sync", type: "skill", tags: ["知识库", "笔记", "同步"], descriptionZh: "Obsidian 同步", score: { total: 78 } }),
    p({ id: "dev/commit-helper", name: "commit-helper", type: "cordis-plugin", tags: ["git", "开发辅助"], descriptionZh: "提交信息助手", score: { total: 40 } }),
  ];
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), plugins };
}
