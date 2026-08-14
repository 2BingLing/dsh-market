/**
 * DSH Market 共享数据类型（schema 包）
 * collector 生成、web 与 plugin 消费，三端必须遵守同一份定义。
 */

/** 插件形态 */
export type PluginType = "skill" | "cordis-plugin";

/** 一键安装方式 */
export type InstallMethod =
  | "skills-add" // git clone 到 ~/.agents/skills（skill 型）
  | "pnpm-profile" // 在目标 profile 中 pnpm add + patch（cordis 插件型）
  | "git-clone"; // 通用 clone（暂未细分）

/** 实用五维评分明细 */
export interface PracticalScoreBreakdown {
  /** 维护活跃 0-100 */
  maintain: number;
  /** 实用度 0-100 */
  practical: number;
  /** 生态热度 0-100 */
  popularity: number;
  /** 便捷度 0-100 */
  ease: number;
  /** 信号质量 0-100 */
  signal: number;
}

export interface PracticalScore {
  /** 融合后的总分 0-100 */
  total: number;
  breakdown: PracticalScoreBreakdown;
  /** 数据置信度 0-1（字段不全/样本少时降权） */
  confidence: number;
  /** 解释层："为什么推荐"的自然语言理由 */
  explanation: string;
}

export interface InstallInfo {
  method: InstallMethod;
  /** skill 型：~/.agents/skills；cordis 型：profile 名 */
  target?: string;
  /** 是否需要 token / API key 等额外配置 */
  needsConfig: boolean;
  /** 从 README 安装章节解析出的真实安装命令（精确命令优先于模板） */
  commands?: string[];
  /** 命令来源（README 安装章节 / 模板兜底） */
  commandSource?: string;
}

export interface DshPlugin {
  /** 唯一标识 owner/repo（同仓库多技能时用 owner/repo@skill-name） */
  id: string;
  type: PluginType;
  name: string;
  owner: string;
  repo: string;
  fullName: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  description: string;
  descriptionZh: string | null;
  /** 功能标签（LLM 打标 + 关键词兜底） */
  tags: string[];
  /** 人工精选标记 */
  curated: boolean;
  /** 精选推荐理由（人工填写） */
  curatedReason?: string;
  homepage: string | null;
  license: string | null;
  topics: string[];
  pushedAt: string;
  createdAt: string;
  updatedAt: string;
  /** README 摘要（截断，供详情页展示） */
  readmeSummary: string | null;
  /** 安装相关信息 */
  install: InstallInfo;
  /** 实用五维评分 */
  score: PracticalScore;
  /** 数据源（awesome/topic/org/user-submit） */
  sources: string[];
  lastCheckedAt: string;
}

export interface MarketData {
  schemaVersion: number;
  generatedAt: string;
  plugins: DshPlugin[];
}
