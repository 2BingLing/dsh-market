/**
 * 仓库特征检测：判断一个仓库是不是 DSH 插件，以及它的类型/安装方式
 *
 * 判据（按优先级，只基于根目录文件列表，零额外 API 调用）：
 * 1. 根目录有 SKILL.md            -> skill 型
 * 2. skills/ 目录含 SKILL.md      -> skill 型（技能集合仓库）
 * 3. 根目录有 dsh.profile 或 cordis.patch.yml -> cordis-plugin 型
 * 4. package.json 依赖含 cordis   -> cordis-plugin 型
 *
 * needsConfig 需要 README 内容，由调用方在抓取 README 后单独调用 detectNeedsConfig。
 */

import type { InstallMethod, PluginType } from "@dsh-market/schema";
import { fetchRepoRoot, type RepoContentItem } from "./github.js";

export interface Detection {
  isPlugin: boolean;
  type: PluginType | null;
  installMethod: InstallMethod | null;
  /** 根目录发现的 skill 清单（技能集合仓库用） */
  skillFiles: string[];
  /** 检测依据说明（供报告） */
  evidence: string[];
}

const SKILL_MARKER = "SKILL.md";
const CORDIS_MARKERS = ["dsh.profile", "cordis.patch.yml", "dsh.profile.yml"];

export async function detectPlugin(
  fullName: string,
  rootItems: RepoContentItem[]
): Promise<Detection> {
  const evidence: string[] = [];
  const skillFiles: string[] = [];
  const names = new Set(rootItems.map((i) => i.name.toLowerCase()));

  // 1. 根目录 SKILL.md
  if (names.has(SKILL_MARKER.toLowerCase())) {
    evidence.push("root SKILL.md");
    skillFiles.push(SKILL_MARKER);
  }

  // 2. skills/ 目录（仅当根目录没有 SKILL.md 时探测，节省调用）
  if (skillFiles.length === 0) {
    const skillsDir = rootItems.find(
      (i) => i.type === "dir" && /^skills?$/i.test(i.name)
    );
    if (skillsDir) {
      const subItems = await fetchRepoRoot(fullName, undefined, skillsDir.path);
      const skillDocs = subItems.filter(
        (i) => i.type === "file" && i.name.toUpperCase() === "SKILL.MD"
      );
      if (skillDocs.length > 0) {
        evidence.push(`skills/ dir (${skillDocs.length} SKILL.md)`);
        skillFiles.push(...skillDocs.map((d) => d.path));
      }
    }
  }

  // 3. cordis 标记文件
  const hasCordisMarker = rootItems.some(
    (i) => i.type === "file" && CORDIS_MARKERS.includes(i.name.toLowerCase())
  );
  if (hasCordisMarker) evidence.push("cordis marker file");

  // 4. package.json 需要调用方抓取后调用 isCordisPackageJson 判定
  const hasPackageJson = names.has("package.json");
  if (hasPackageJson) evidence.push("has package.json");

  const isSkill = skillFiles.length > 0;
  const isCordis = hasCordisMarker || hasPackageJson; // package.json 需二次确认
  if (!isSkill && !isCordis) {
    return {
      isPlugin: false,
      type: null,
      installMethod: null,
      skillFiles: [],
      evidence,
    };
  }

  const type: PluginType = isSkill ? "skill" : "cordis-plugin";
  const installMethod: InstallMethod = type === "skill" ? "skills-add" : "pnpm-profile";

  return { isPlugin: true, type, installMethod, skillFiles, evidence };
}

const CORDIS_PKG_KEYWORDS = [
  "cordis",
  "@cordisjs/plugin",
  "dsh-base",
  "@deepseek-ai/dsh-",
];

/** package.json 内容是否为 cordis 插件（需有 package.json 且依赖含 cordis 关键字） */
export function isCordisPackageJson(content: string | null): boolean {
  if (!content) return false;
  try {
    const pkg = JSON.parse(content);
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    return Object.keys(deps).some((d) =>
      CORDIS_PKG_KEYWORDS.some((k) => d.includes(k))
    );
  } catch {
    return false;
  }
}

/** 检测 README/SKILL 内容中的"需要配置"信号（具体环境变量名） */
const CONFIG_KEY_RE =
  /(?:^|[^A-Za-z])(GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|LLM_API_KEY|API_KEY|CLAUDE_API_KEY|AZURE_OPENAI|AWS_ACCESS_KEY|STRIPE_API_KEY)(?:[^A-Za-z]|$)/i;

export function detectNeedsConfig(readmeContent: string | null): boolean {
  return readmeContent !== null && CONFIG_KEY_RE.test(readmeContent);
}
