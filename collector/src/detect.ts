/**
 * 仓库特征检测：判断一个仓库是不是 DSH 插件，以及它的类型/安装方式
 *
 * 判据（按优先级）：
 * 1. 根目录有 SKILL.md            -> skill 型
 * 2. skills/ 目录含 SKILL.md      -> skill 型（技能集合仓库）
 * 3. 根目录有 dsh.profile 或 cordis.patch.yml -> cordis-plugin 型
 * 4. package.json 依赖含 cordis   -> cordis-plugin 型
 */

import type { InstallMethod, PluginType } from "@dsh-market/schema";
import {
  fetchFileViaApi,
  fetchRepoRoot,
  type RepoContentItem,
} from "./github.js";

export interface Detection {
  isPlugin: boolean;
  type: PluginType | null;
  installMethod: InstallMethod | null;
  needsConfig: boolean;
  /** 根目录发现的 skill 清单（技能集合仓库用） */
  skillFiles: string[];
  /** 检测依据说明（供报告） */
  evidence: string[];
}

const SKILL_MARKER = "SKILL.md";
const CORDIS_MARKERS = ["dsh.profile", "cordis.patch.yml", "dsh.profile.yml"];
const CORDIS_PKG_KEYWORDS = [
  "cordis",
  "@cordisjs/plugin",
  "dsh-base",
  "@deepseek-ai/dsh-",
];

function isCordisPackageJson(content: string): boolean {
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

/** 检查文件列表里是否含某文件名（含子目录 skills/） */
function findIn(items: RepoContentItem[], name: string): RepoContentItem | null {
  return items.find((i) => i.name === name || i.path.endsWith(`/${name}`)) ?? null;
}

export async function detectPlugin(
  fullName: string,
  rootItems: RepoContentItem[],
  readmeContent: string | null
): Promise<Detection> {
  const evidence: string[] = [];
  const skillFiles: string[] = [];

  // 1. 根目录 SKILL.md
  if (findIn(rootItems, SKILL_MARKER)) {
    evidence.push("root SKILL.md");
    skillFiles.push(SKILL_MARKER);
  }

  // 2. skills/ 目录
  const skillsDir = rootItems.find((i) => i.type === "dir" && /^skills?$/i.test(i.name));
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

  // 3. cordis 标记文件
  const hasCordisMarker = rootItems.some(
    (i) => i.type === "file" && CORDIS_MARKERS.includes(i.name.toLowerCase())
  );
  if (hasCordisMarker) {
    evidence.push("cordis marker file");
  }

  // 4. package.json 依赖
  let isCordisPkg = false;
  const pkgItem = findIn(rootItems, "package.json");
  if (pkgItem) {
    const pkg = await fetchFileViaApi(fullName, pkgItem.path);
    if (pkg && isCordisPackageJson(pkg.content)) {
      isCordisPkg = true;
      evidence.push("package.json cordis deps");
    }
  }

  // 5. 无特征 → 不是插件
  const isSkill = skillFiles.length > 0;
  const isCordis = hasCordisMarker || isCordisPkg;
  if (!isSkill && !isCordis) {
    return { isPlugin: false, type: null, installMethod: null, needsConfig: false, skillFiles: [], evidence };
  }

  const type: PluginType = isSkill && !isCordis ? "skill" : "cordis-plugin";
  // 两者都有的仓库：SKILL 型更可能（skill 集合 + cordis 工具），取 skill
  const finalType: PluginType = isSkill ? "skill" : "cordis-plugin";
  const installMethod: InstallMethod =
    finalType === "skill" ? "skills-add" : "pnpm-profile";

  // 6. needsConfig：README 内容里的强信号
  let needsConfig = false;
  if (readmeContent && CONFIG_KEY_RE.test(readmeContent)) {
    needsConfig = true;
    evidence.push("README mentions API key/token config");
  }

  return {
    isPlugin: true,
    type: finalType,
    installMethod,
    needsConfig,
    skillFiles,
    evidence,
  };
}
