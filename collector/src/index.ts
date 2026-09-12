/**
 * collector 主流程（v2：并发 + 缓存）
 * 扫描 → 去重合并 → 特征检测 → 元数据+README → 实用五维评分 → 输出 data/plugins.json
 *
 * 用法：npm run collect（根目录，自动加载 .env 的 GITHUB_TOKEN）
 * 输出：data/plugins.json（市场数据）、data/report.json（统计报告）
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshPlugin, DshPack, MarketData } from "@dsh-market/schema";
import { toLiteMarketData } from "@dsh-market/core";
import "./env.js"; // 加载仓库根 .env（GITHUB_TOKEN）
import {
  githubFetch,
  fetchRepoRoot,
  fetchRawFile,
  fetchFileViaApi,
  GithubError,
  sleep,
  type GithubRepo,
} from "./github.js";
import { fetchAwesomeEntries } from "./sources/awesome.js";
import { scanByTopics, scanOrg } from "./sources/github-search.js";
import { fetchSubmissionRepos, fetchPackSubmissionRepos } from "./sources/issues.js";
import { mergeCorrections, type DataCorrections } from "./sources/corrections.js";
import { detectPlugin, isCordisPackageJson, detectNeedsConfig, detectUsageNeedsConfig, detectSubdirBundle, extractDshEngines } from "./detect.js";
import { computePracticalScore, computeP99Stars } from "./scoring.js";
import { cached, cacheGet, cacheSet } from "./cache.js";
import { batchProbeRepos } from "./decay-probe.js";
import { runPool } from "./pool.js";
import { translateWithDeepSeek } from "./llm.js";
import { parseInstallCommands } from "./install-parse.js";
import { normalizeTags } from "./tag-normalize.js";
import { summarizeReadme } from "./summary.js";
import { collectPacks } from "./packs.js";

/** 检测结果缓存（增量核心：repo 未变化时复用，跳过重复检测网络调用） */
interface DetectCache {
  pushedAt: string;
  detection: {
    isPlugin: boolean;
    type: import("@dsh-market/schema").PluginType | null;
    installMethod: import("@dsh-market/schema").InstallMethod | null;
    skillFiles: string[];
    evidence: string[];
  };
  isCordis: boolean;
  needsConfig: boolean;
  /** 使用/运行时需配置模型（旧缓存缺省 undefined，读取时按 false） */
  usageNeedsConfig?: boolean;
  readmeSummary: string | null;
  installParsed: { commands: string[]; source: string };
  hasSkillMd: boolean;
  /** 子目录 bundle 的插件子目录路径（如 dsh-pet/），null = 常规根目录插件 */
  subdir: string | null;
  /** 声明的 DSH 宿主版本要求（N2；旧缓存缺省 undefined = 未知，不迁移、靠 TTL 自然刷新） */
  dshEngines?: string | null;
  dshEnginesSource?: string;
  /** 存在性最近一次被真实核实的时间（扫描命中 / API 确认 / 批量探测）。
   *  直补回写缓存**不刷新**它——这是 D5 直补门禁的依据：超过 14 天未核实就必须重新查 existence，
   *  防止已删除仓库靠"直补→刷新 mtime→永不过期"的自续命循环永久留位。 */
  lastVerifiedAt?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const CONCURRENCY = 10;
const EXCLUDED_REPOS = new Set([
  "deepseek-ai/deepseek-harness", // 官方本体，非插件
  "deepseek-ai/awesome-deepseek-harness",
]);

interface Candidate {
  repo: GithubRepo | null;
  fullName: string;
  sources: string[];
  awesomeName?: string;
  awesomeDescription?: string;
  /** 提交插件 issue 号（issue-submission 来源；收录成功后自动回复用） */
  issueNumbers?: number[];
  /** 作者自述简介（提交 issue 时提供，可选；存到 plugin.introByAuthor） */
  introByAuthor?: string;
  /** 数据修正（`[数据修正]` issue）：覆盖作者自述/中文简介等 */
  corrections?: DataCorrections;
}

interface Detected {
  candidate: Candidate;
  plugin: DshPlugin;
  repo: GithubRepo;
  readmeContent: string | null;
  hasSkillMd: boolean;
}

/** 读取上次生成的中文数据（增量：只翻译缺失的插件） */
function loadPreviousZh(): Map<string, { descriptionZh: string | null; tagsZh: string[] }> {
  try {
    const raw = readFileSync(join(DATA_DIR, "plugins.json"), "utf-8");
    const prev = JSON.parse(raw) as MarketData;
    return new Map(
      prev.plugins.map((p) => [
        p.id,
        { descriptionZh: p.descriptionZh ?? null, tagsZh: (p.tags ?? []).filter((t) => /[\u4e00-\u9fff]/.test(t)) },
      ])
    );
  } catch {
    return new Map();
  }
}

/* ===== A：持久化中文翻译缓存（跨天累积，波动回归的插件复用旧翻译，不重复翻译）===== */
import { shouldRetranslate, type ZhEntry } from "./zh-util.js";

interface ZhCache {
  updatedAt: string;
  entries: Record<string, ZhEntry>;
}
const ZH_CACHE_FILE = join(DATA_DIR, "zh-cache.json");

function loadZhCache(): Map<string, ZhEntry> {
  try {
    const raw = JSON.parse(readFileSync(ZH_CACHE_FILE, "utf-8")) as ZhCache;
    return new Map(Object.entries(raw.entries ?? {}));
  } catch {
    return new Map();
  }
}
function saveZhCache(entries: Map<string, ZhEntry>): void {
  try {
    const out: ZhCache = { updatedAt: new Date().toISOString(), entries: Object.fromEntries(entries) };
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ZH_CACHE_FILE, JSON.stringify(out), "utf-8");
  } catch (err) {
    console.warn(`  zh-cache 保存失败: ${(err as Error).message}`);
  }
}

/* ===== B2：已收录延续性——读取上次完整插件记录（id → plugin）===== */
function loadPreviousPlugins(): Map<string, DshPlugin> {
  try {
    const raw = readFileSync(join(DATA_DIR, "plugins.json"), "utf-8");
    const prev = JSON.parse(raw) as MarketData;
    return new Map(prev.plugins.map((p) => [p.id.toLowerCase(), p]));
  } catch {
    return new Map();
  }
}

/** 从插件记录构造最小 GithubRepo（B2 检测缓存直补用：仓库未变，无需 API 即补回） */
function repoStubFromPlugin(p: DshPlugin): GithubRepo {
  return {
    id: 0, // stub：B2 直补项不依赖真实 id
    full_name: p.fullName,
    name: p.repo,
    owner: { login: p.owner },
    stargazers_count: p.stars,
    forks_count: p.forks,
    open_issues_count: p.openIssues,
    language: p.language,
    description: p.description || null,
    license: p.license ? { spdx_id: p.license } : null,
    homepage: p.homepage,
    topics: p.topics,
    pushed_at: p.pushedAt,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    default_branch: null,
    archived: false,
    fork: false,
  };
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error("缺少 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }

  console.log("=== DSH Market collector v2 ===");
  // 阶段计时：每个阶段开始时调用 stage("上一阶段名") 打印耗时
  let stageT0 = Date.now();
  const stage = (name: string) => {
    const el = Math.round((Date.now() - stageT0) / 1000);
    console.log(`  ⏱ ${name} 用时 ${el}s`);
    stageT0 = Date.now();
  };
  console.log("[1/5] 扫描数据源...");

  // 1. awesome 列表（人工策展）
  const awesomeEntries = await fetchAwesomeEntries(async (o, r, p) => {
    for (const branch of ["main", "master"]) {
      const res = await fetch(
        `https://raw.githubusercontent.com/${o}/${r}/${branch}/${p}`,
        { headers: { "User-Agent": "dsh-market-collector" }, signal: AbortSignal.timeout(20_000) }
      );
      if (res.ok) return res.text();
    }
    return null;
  });
  const awesomeByFullName = new Map(
    awesomeEntries.map((e) => [e.fullName, e])
  );
  console.log(`  awesome lists -> ${awesomeByFullName.size} entries`);

  // 2. topic 搜索 + 组织
  const topicRepos = await scanByTopics();
  const orgRepos = await scanOrg();

  // 2.5 提交插件 issue（人工提交的仓库，并入候选池走相同检测流程）
  // fullName(lower) -> issue 号列表（收录成功后用于自动回复）
  const issueRepos = await fetchSubmissionRepos();

  // 3. 合并去重
  const candidates = new Map<string, Candidate>();
  const addCandidate = (
    fullName: string,
    repo: GithubRepo | null,
    source: string,
    meta?: { name?: string; description?: string; issueNumbers?: number[]; introByAuthor?: string; corrections?: DataCorrections }
  ) => {
    const key = fullName.toLowerCase();
    if (EXCLUDED_REPOS.has(key)) return;
    const existing = candidates.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (!existing.repo && repo) existing.repo = repo;
      if (meta?.issueNumbers) {
        existing.issueNumbers = [
          ...new Set([...(existing.issueNumbers ?? []), ...meta.issueNumbers]),
        ];
      }
      // issue 里的「作者自述」同样要并入：候选多由 topic 扫描先创建，
      // 此前该字段只在首次创建时写入 → 已收录插件的自述永远进不来
      if (meta?.introByAuthor && !existing.introByAuthor) {
        existing.introByAuthor = meta.introByAuthor;
      }
      // 数据修正并入：逐字段合并（后到 issue 的修正覆盖先到的，含「无」清空）
      existing.corrections = mergeCorrections(existing.corrections, meta?.corrections);
      return;
    }
    candidates.set(key, {
      repo,
      fullName,
      sources: [source],
      awesomeName: meta?.name,
      awesomeDescription: meta?.description,
      issueNumbers: meta?.issueNumbers,
      introByAuthor: meta?.introByAuthor,
      corrections: meta?.corrections,
    });
  };
  for (const fn of awesomeByFullName.keys()) {
    const e = awesomeByFullName.get(fn)!;
    addCandidate(fn, null, e.source, { name: e.name, description: e.description });
  }
  for (const r of topicRepos) addCandidate(r.full_name, r, "topic");
  for (const r of orgRepos) addCandidate(r.full_name, r, "org");
  for (const [fn, meta] of issueRepos) {
    addCandidate(fn, null, "issue-submission", {
      issueNumbers: meta.issueNumbers,
      introByAuthor: meta.introByAuthor,
      corrections: meta.corrections,
    });
  }

  const all = [...candidates.values()];
  console.log(`  candidates: ${all.length}`);

  stage("[1/5] 扫描数据源");
  console.log("[2/5] 特征检测 + 元数据抓取（并发 10，带缓存）...");
  const detected: Detected[] = [];
  const rejected: { fullName: string; reason: string }[] = [];
  // 上次收录记录：B2 延续性 + 作者自述持久化（见下）
  const prevPlugins = loadPreviousPlugins();

  const detectOne = async (candidate: Candidate) => {
    try {
      // repo 元数据（缓存 24h）
      let repo = candidate.repo;
      if (!repo) {
        repo = await cached<GithubRepo>("repos", candidate.fullName, () =>
          githubFetch<GithubRepo>(`/repos/${candidate.fullName}`)
        );
        if (repo.fork || repo.archived) {
          rejected.push({ fullName: candidate.fullName, reason: "fork/archived" });
          return;
        }
      }

      // ===== 检测结果缓存（增量核心）：repo 未变化则复用，跳过全部检测网络调用 =====
      const DETECT_TTL = 7 * 24 * 3600_000;
      const cachedDetect = cacheGet<DetectCache>("detect", candidate.fullName, DETECT_TTL);
      let detection: Awaited<ReturnType<typeof detectPlugin>>;
      let isCordis: boolean;
      let needsConfig: boolean;
      let usageNeedsConfig: boolean;
      let readmeSummary: string | null;
      let installParsed: { commands: string[]; source: string };
      let hasSkillMd: boolean;
      let readmeContent: string | null;
      let subdir: string | null = null;
      /** DSH 宿主版本要求（N2）；未知即 null，UI 按"未知"处理 */
      let dshEngines: string | null = null;
      let dshEnginesSource: string | undefined;

      if (cachedDetect && cachedDetect.pushedAt === repo.pushed_at && cachedDetect.detection.isPlugin) {
        // 命中：仓库未变化且缓存为插件，直接复用检测产物（零网络调用）
        detection = cachedDetect.detection;
        isCordis = cachedDetect.isCordis;
        needsConfig = cachedDetect.needsConfig;
        usageNeedsConfig = cachedDetect.usageNeedsConfig ?? false;
        readmeSummary = cachedDetect.readmeSummary;
        installParsed = cachedDetect.installParsed;
        hasSkillMd = cachedDetect.hasSkillMd;
        subdir = cachedDetect.subdir ?? null;
        // 旧缓存没有 dshEngines 字段 → undefined/null = 未知；等 TTL 过期或仓库有推送时自然补上
        dshEngines = cachedDetect.dshEngines ?? null;
        dshEnginesSource = cachedDetect.dshEnginesSource;
        readmeContent = null; // 评分用：下面从 readmes 缓存取（24h 内必有）
      } else {
        // 未命中/仓库变化/缓存为 false（历史遗留误判如 #123 reasoning-bridge）：
        // false 缓存不信任（新代码 aed60b3 后不写 false 缓存）→ 完整重检覆盖
        if (cachedDetect && !cachedDetect.detection.isPlugin) {
          console.warn(`  [cache] ${candidate.fullName} 缓存为 false（历史遗留），重检覆盖`);
        }
        // 根目录文件列表（缓存 24h）
        const rootItems = await cached(
          "roots",
          candidate.fullName,
          () => fetchRepoRoot(repo!.full_name, repo!.default_branch)
        );

        // 特征检测（只基于文件列表）
        detection = await detectPlugin(candidate.fullName, rootItems);
        if (!detection.isPlugin) {
          // 子目录 bundle 探测：根目录无标记时，检查子目录内的插件成品（如 dsh-pet/）
          const sub = await detectSubdirBundle(
            candidate.fullName,
            rootItems,
            repo!.default_branch
          );
          if (sub) {
            detection = {
              isPlugin: true,
              type: "cordis-plugin",
              installMethod: "pnpm-profile",
              skillFiles: [],
              evidence: sub.evidence,
            };
            subdir = sub.subdir;
          } else {
            rejected.push({ fullName: candidate.fullName, reason: "no plugin markers" });
            return;
          }
        }

        // package.json 二次确认（子目录 bundle 时读子目录内的 package.json）
        let packageJsonContent: string | null = null;
        const pkgRel = subdir ? `${subdir}/package.json` : "package.json";
        const hasPkgJson =
          rootItems.some((i) => i.name.toLowerCase() === "package.json") || Boolean(subdir);
        if (hasPkgJson) {
          packageJsonContent = await cached<string | null>(
            "pkgjson",
            candidate.fullName + (subdir ? `:${subdir}` : ""),
            async () => {
              const f = await fetchFileViaApi(candidate.fullName, pkgRel);
              return f?.content ?? null;
            }
          );
        }
        isCordis = isCordisPackageJson(packageJsonContent);
        // 实际生效的 package.json（子目录 bundle 兜底时会换成子目录那份）——N2 的 engines 提取以它为准
        let effectivePkgJson = packageJsonContent;
        // skill 型但 package.json 声明 cordis 结构（npm 发布的 cordis 插件常附带 SKILL.md 当文档）→ 改判 cordis-plugin（#95）
        if (detection.type === "skill" && isCordis) {
          detection = {
            isPlugin: true,
            type: "cordis-plugin",
            installMethod: "pnpm-profile",
            skillFiles: [],
            evidence: [...detection.evidence, "package.json cordis（SKILL.md 改判）"],
          };
        }
        // dsh-manifest.json / dsh.plugin.json 声明式插件：清单本身就是插件证据，跳过 package.json 二次确认（#53/#123 类）
        const hasManifest = rootItems.some(
          (i) =>
            i.name.toLowerCase() === "dsh-manifest.json" ||
            i.name.toLowerCase() === "dsh.plugin.json"
        );
        if (detection.type === "cordis-plugin" && !isCordis && !hasManifest) {
          // monorepo / 子目录兜底：根 package.json 是 workspace 根（非插件），插件在子目录（#52 类）
          const sub = await detectSubdirBundle(candidate.fullName, rootItems, repo!.default_branch);
          if (sub) {
            detection = {
              isPlugin: true,
              type: "cordis-plugin",
              installMethod: "pnpm-profile",
              skillFiles: [],
              evidence: sub.evidence,
            };
            subdir = sub.subdir;
            // 子目录 package.json 二次确认
            const subPkgRel = `${subdir}/package.json`;
            const subPkg = await cached<string | null>(
              "pkgjson",
              candidate.fullName + `:${subdir}`,
              async () => {
                const f = await fetchFileViaApi(candidate.fullName, subPkgRel);
                return f?.content ?? null;
              }
            );
            isCordis = isCordisPackageJson(subPkg);
            effectivePkgJson = subPkg;
            if (!isCordis) {
              rejected.push({ fullName: candidate.fullName, reason: "package.json not cordis" });
              return;
            }
          } else {
            rejected.push({ fullName: candidate.fullName, reason: "package.json not cordis" });
            return;
          }
        }

        // N2 · DSH 宿主版本要求：从生效的 package.json 提取（engines.dsh 优先，DSH 依赖约束兜底）。
        // 拿不准就是 null（未知）—— 绝不用猜测的版本去拦截安装
        const engines = extractDshEngines(effectivePkgJson);
        if (engines) {
          dshEngines = engines.range;
          dshEnginesSource = engines.source;
        }

        // README（缓存 24h）
        readmeContent = await cached<string | null>(
          "readmes",
          candidate.fullName,
          () => fetchRawFile(candidate.fullName, "README.md", repo!.default_branch)
        );

        // skill 型：抓 SKILL.md 做摘要
        let skillMd: string | null = null;
        if (detection.skillFiles.length > 0) {
          skillMd = await cached<string | null>(
            "skills",
            `${candidate.fullName}:${detection.skillFiles[0]}`,
            () =>
              fetchRawFile(
                candidate.fullName,
                detection.skillFiles[0],
                repo!.default_branch
              )
          );
        }

        needsConfig = detectNeedsConfig(readmeContent);
        usageNeedsConfig = detectUsageNeedsConfig(readmeContent);
        readmeSummary = readmeContent
          ? summarizeReadme(readmeContent)
          : skillMd
            ? summarizeReadme(skillMd)
            : null;
        installParsed = parseInstallCommands(readmeContent);
        hasSkillMd = detection.skillFiles.length > 0;

        // 写入检测缓存（含派生产物）——仅插件命中时写；非插件（isPlugin:false）不写缓存，
        // 避免"误判无标记"被缓存固化（作者补标记后仍 stuck 7 天，#123 dsh-reasoning-bridge 教训）
        if (detection.isPlugin) {
          cacheSet<DetectCache>("detect", candidate.fullName, {
            pushedAt: repo.pushed_at,
            detection,
            isCordis,
            needsConfig,
            usageNeedsConfig,
            readmeSummary,
            installParsed,
            hasSkillMd,
            subdir,
            dshEngines,
            dshEnginesSource,
            // 本次来自实时扫描命中 = 存在性刚被核实（D5 lastVerifiedAt 的三个写入点之一）
            lastVerifiedAt: new Date().toISOString(),
          });
        }
      }

      // 评分用的 readmeContent：检测缓存命中时从 readmes 缓存补取（不重新抓取）
      if (readmeContent === null) {
        readmeContent = cacheGet<string | null>("readmes", candidate.fullName, 24 * 3600_000);
      }

      const installCommands =
        installParsed.commands.length > 0 ? installParsed.commands : undefined;
      const installMethod = detection.installMethod!;

      // 作者自述：issue 是唯一来源，且采集只读 open issue——收录确认后 issue 会被自动关闭，
      // 因此关闭后沿用上次抓到的自述，否则自述会在次日随 issue 关闭一起消失；
      // `[数据修正]` issue 的修正（含「无」清空）拥有最高优先级
      const corr = candidate.corrections;
      let introByAuthor =
        candidate.introByAuthor ?? prevPlugins.get(candidate.fullName.toLowerCase())?.introByAuthor;
      if (corr && corr.introByAuthor !== undefined) {
        introByAuthor = corr.introByAuthor ?? undefined; // 作者自述：无 → 清空
      }
      // 中文简介/文案修正（数据修正 issue 提供时覆盖；否则 M3 阶段 DeepSeek 生成）
      let descriptionZh: string | null = null;
      if (corr?.descriptionZh) descriptionZh = corr.descriptionZh;
      // 安装命令修正（数据修正 issue 提供时覆盖 README 解析结果，#137）
      let commandSource = installParsed.source === "template" ? undefined : installParsed.source;
      if (corr?.installCommands) commandSource = "issue-correction";

      const plugin: DshPlugin = {
        id: repo!.full_name,
        type: detection.type!,
        name: candidate.awesomeName ?? repo!.name,
        owner: repo!.owner.login,
        repo: repo!.name,
        fullName: repo!.full_name,
        stars: repo!.stargazers_count,
        forks: repo!.forks_count,
        openIssues: repo!.open_issues_count,
        language: repo!.language,
        description: candidate.awesomeDescription ?? repo!.description ?? "",
        descriptionZh, // 数据修正优先；否则 M3: DeepSeek 生成
        tags: [...repo!.topics],
        curated: false,
        homepage: repo!.homepage,
        license: repo!.license?.spdx_id ?? null,
        topics: repo!.topics,
        pushedAt: repo!.pushed_at,
        createdAt: repo!.created_at,
        updatedAt: repo!.updated_at,
        readmeSummary,
        introByAuthor,
        submissionIssue: candidate.issueNumbers?.[0],
        install: {
          method: installMethod,
          target: detection.type === "skill" ? "~/.agents/skills" : undefined,
          needsConfig,
          usageNeedsConfig,
          commands: corr?.installCommands ?? installCommands,
          commandSource,
          // N2：宿主版本要求。dshEngines=null 时**不写字段**（保持"未知"语义，
          // 避免把这个键写满全量数据却不带信息量），这样 web/public/*.json 体积也不膨胀
          ...(dshEngines ? { dshEngines, dshEnginesSource } : {}),
        },
        score: undefined as unknown as DshPlugin["score"],
        sources: candidate.sources,
        lastCheckedAt: new Date().toISOString(),
      };
      detected.push({
        candidate,
        plugin,
        repo: repo!,
        readmeContent,
        hasSkillMd: detection.skillFiles.length > 0,
      });
    } catch (err) {
      rejected.push({
        fullName: candidate.fullName,
        reason: `error: ${(err as Error).message.slice(0, 80)}`,
      });
    }
  };

  await runPool(all, detectOne);

  // [retry-error] 瞬时失败候选重试：限流/网络波动被 error-reject 的不该直接放弃
  //（否则只能等下一天 cron，如 issue #32/#33/#35 被漏检）
  // 注意：刚撞完限流立刻重试会再撞限流导致每个请求退避堆叠（曾拖 35 分钟）——
  // 重试前先冷却限流窗口 + 限制重试数量，超出部分留给下次 cron 自然重试
  const errorIds = new Set(
    rejected.filter((r) => r.reason.startsWith("error")).map((r) => r.fullName.toLowerCase())
  );
  if (errorIds.size > 0) {
    const retry = all
      .filter((c) => errorIds.has(c.fullName.toLowerCase()))
      .slice(0, 60);
    console.log(`  [retry-error] ${retry.length} 个瞬时失败候选，冷却 45s 后重试（并发 10，超出留给下轮）...`);
    await sleep(45_000); // 限流窗口冷却，避免重试再撞限流
    await runPool(retry, detectOne);
    console.log(`  [retry-error] 完成，detected=${detected.length}`);
  }

  console.log(`  detected: ${detected.length}, rejected: ${rejected.length}`);

  // 去重：GitHub 仓库转移会让同一仓库从多个旧路径进入，full_name 归一化后 id 相同
  {
    const byId = new Map<string, Detected>();
    for (const d of detected) {
      const existing = byId.get(d.plugin.id);
      if (existing) {
        for (const s of d.plugin.sources) {
          if (!existing.plugin.sources.includes(s)) existing.plugin.sources.push(s);
        }
        continue;
      }
      byId.set(d.plugin.id, d);
    }
    const deduped = [...byId.values()];
    if (deduped.length !== detected.length) {
      console.log(`  dedup: ${detected.length} -> ${deduped.length} (repo transfers)`);
    }
    detected.length = 0;
    detected.push(...deduped);
  }

  // [B2] 已收录延续性：上次收录但本次未扫描到的仓库补回（防边界抖动消失；404 确认真删除才移除）
  // 直补（零 API）只对 14 天内被真实核实过存在性的条目开放（D5 门禁，见 VERIFY_INTERVAL）；
  // 缓存缺失/门禁到期的分别走 REST 逐个确认 / GraphQL 批量复核——避免对上千 miss 逐个请求撞限流（曾让 cron 从 10 分钟涨到 2 小时）
  const currentIds = new Set(detected.map((d) => d.plugin.id.toLowerCase()));
  const missing = [...prevPlugins.keys()].filter((id) => !currentIds.has(id));
  let restored = 0;
  let confirmedGone = 0;
  if (missing.length > 0) {
    const DETECT_TTL = 7 * 24 * 3600_000;
    /** D5 强制复核间隔：缓存里的存在性超过这么久没被真实核实 → 直补前必须重新查
     *  （检测数据 7 天 TTL 管的是"内容有没有变"，lastVerifiedAt 管的是"仓库还在不在"，两者独立） */
    const VERIFY_INTERVAL = 14 * 24 * 3600_000;
    const directRestore: string[] = [];
    const needVerify: string[] = [];
    const needApi: string[] = [];
    for (const id of missing) {
      const dc = cacheGet<DetectCache>("detect", id, DETECT_TTL);
      if (!dc) {
        needApi.push(id);
        continue;
      }
      // D5 门禁：直补只续命 14 天。lastVerifiedAt 只在真实核实（扫描命中/API 确认/批量探测）时写入，
      // 直补回写不刷新它 → 已删除仓库至多 14 天必被核实一次，无法再靠直补永久留位
      const lastV = dc.lastVerifiedAt ? Date.parse(dc.lastVerifiedAt) : NaN;
      if (Number.isFinite(lastV) && Date.now() - lastV < VERIFY_INTERVAL) directRestore.push(id);
      else needVerify.push(id);
    }
    /** B2 补回公共体：复用上次记录进 detected + 回写检测缓存。
     *  verified=true 表示本次经过了真实存在性核实 → 写入 lastVerifiedAt（直补传 false，不刷新时间戳）。
     *  写回缓存的原因：直补条目若不写缓存，下轮仍算"缓存缺失/过期"→ needApi 死循环
     *  （曾致每次 cron 检测 60 分钟 + 收录数不保）。 */
    const pushRestore = (id: string, prev: DshPlugin, verified: boolean, evidence: string) => {
      detected.push({
        candidate: { fullName: id, repo: null, sources: ["restore"] },
        plugin: { ...prev, lastCheckedAt: new Date().toISOString() },
        repo: repoStubFromPlugin(prev),
        readmeContent: null,
        hasSkillMd: false,
      });
      const existing = cacheGet<DetectCache>("detect", id, DETECT_TTL);
      if (existing) {
        // 强制 isPlugin: true——B2 直补的必然是已收录插件；若旧缓存是 isPlugin:false
        //（某轮误判 non-plugin），保留它会致下轮直接 reject（"no plugin markers (cached)"）把插件挤出市场
        cacheSet<DetectCache>("detect", id, {
          ...existing,
          pushedAt: prev.pushedAt,
          detection: { ...existing.detection, isPlugin: true },
          ...(verified ? { lastVerifiedAt: new Date().toISOString() } : {}),
        });
      } else {
        cacheSet<DetectCache>("detect", id, {
          pushedAt: prev.pushedAt,
          detection: {
            isPlugin: true,
            type: prev.type,
            installMethod: prev.install.method,
            skillFiles: [],
            evidence: [evidence],
          },
          isCordis: true,
          needsConfig: prev.install.needsConfig,
          usageNeedsConfig: prev.install.usageNeedsConfig,
          readmeSummary: prev.readmeSummary,
          installParsed: {
            commands: prev.install.commands ?? [],
            source: prev.install.commandSource ?? "",
          },
          hasSkillMd: prev.type === "skill",
          subdir: null,
          // N2：沿用已收录条目的宿主版本要求——不回填会把上一轮已抓到的值抹掉
          dshEngines: prev.install.dshEngines ?? null,
          dshEnginesSource: prev.install.dshEnginesSource,
          ...(verified ? { lastVerifiedAt: new Date().toISOString() } : {}),
        });
      }
      restored++;
    };
    // 1) 缓存直补（零 API）：14 天内被真实核实过的条目，直接复用上次记录
    for (const id of directRestore) {
      pushRestore(id, prevPlugins.get(id)!, false, "B2 restore 缓存回写");
    }
    if (directRestore.length > 0) console.log(`  [B2] 检测缓存直补 ${directRestore.length} 个（零 API）`);
    // 1.5) D5 强制复核（GraphQL 批量，100 个/请求，复用 decay 探测层）：
    // 门禁到期的条目重新核实存在性——已删除的在此自动移除（旧逻辑直补路径永远轮不到核实 → 僵尸条目永久留位）
    if (needVerify.length > 0) {
      console.log(`  [B2] ${needVerify.length} 个存在性超过 14 天未核实，批量复核（GraphQL）...`);
      const probe = await batchProbeRepos(needVerify, { budgetMs: 8 * 60_000 });
      let verifiedAlive = 0;
      let verifiedArchived = 0;
      let probeGone = 0;
      const fallback: string[] = [];
      for (const id of needVerify) {
        const snap = probe.map.get(id);
        if (snap === undefined) {
          // 未覆盖（批失败/限流/预算耗尽）：按原样直补保收录，下轮再复核——探测失败绝不能把条目挤掉
          fallback.push(id);
          continue;
        }
        if (snap === null) {
          confirmedGone++; // GraphQL NOT_FOUND：确认已删除 → 自动移除（D5 核心）
          probeGone++;
          continue;
        }
        if (snap.full_name && snap.full_name.toLowerCase() !== id.toLowerCase()) {
          confirmedGone++; // 改名/转移：旧名不补，新名由扫描收录走正常检测（与 REST 路径同口径）
          probeGone++;
          continue;
        }
        if (snap.fork) {
          confirmedGone++; // 与 needApi REST 路径同口径：转成 fork 内容已变，移除、等扫描重收
          probeGone++;
          continue;
        }
        // 归档 ≠ 坏：保留在市场，decay 周报继续提示，去留走数据修正通道由人决定
        if (snap.archived) verifiedArchived++;
        else verifiedAlive++;
        pushRestore(id, prevPlugins.get(id)!, true, "B2 复核存活缓存回写");
      }
      for (const id of fallback) {
        pushRestore(id, prevPlugins.get(id)!, false, "B2 restore 缓存回写");
      }
      console.log(
        `  [B2] 复核结果：存活 ${verifiedAlive + verifiedArchived}（归档保留 ${verifiedArchived}）` +
          `· 确认移除 ${probeGone} · 未覆盖回退直补 ${fallback.length}` +
          `（${probe.stats.requests} 次请求，${Math.round(probe.stats.elapsedMs / 1000)}s）`
      );
    }
    // 2) API 确认（少数）：上限 2500 个/轮，超出留待下次 cron（v2 缓存重建期需要更大恢复量；PAT 双配额已上线）
    if (needApi.length > 2500) {
      console.log(`  [B2] needApi ${needApi.length} 个超上限，本轮确认前 2500 个，其余等下轮`);
      needApi.length = 2500;
    }
    if (needApi.length > 0) {
      console.log(`  [B2] ${needApi.length} 个需 API 确认（缓存缺失）...`);
      await runPool(needApi, async (id) => {
        const prev = prevPlugins.get(id)!;
        try {
          const repo = await githubFetch<GithubRepo>(`/repos/${id}`);
          if (repo.fork || repo.archived) {
            confirmedGone++;
            return;
          }
          // 改名/转移（full_name 变化）：旧名不补，新名由扫描收录走正常检测
          if (repo.full_name.toLowerCase() !== id.toLowerCase()) {
            confirmedGone++;
            return;
          }
          // pushedAt 与上次一致（仓库没变）→ 复用上次记录 + 更新元数据
          if (repo.pushed_at === prev.pushedAt) {
            detected.push({
              candidate: { fullName: id, repo, sources: ["restore"] },
              plugin: {
                ...prev,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                openIssues: repo.open_issues_count,
                language: repo.language,
                pushedAt: repo.pushed_at,
                createdAt: repo.created_at,
                updatedAt: repo.updated_at,
                homepage: repo.homepage ?? prev.homepage,
                lastCheckedAt: new Date().toISOString(),
              },
              repo,
              readmeContent: null,
              hasSkillMd: false,
            });
            restored++;
            // 写回缓存：确认成功的不写缓存会"下次又 needApi → 2500 截断 → 永远等下次"（用户发现的循环）
            cacheSet<DetectCache>("detect", id, {
              pushedAt: prev.pushedAt,
              detection: {
                isPlugin: true,
                type: prev.type,
                installMethod: prev.install.method,
                skillFiles: [],
                evidence: ["B2 API 确认缓存回写"],
              },
              isCordis: true,
              needsConfig: prev.install.needsConfig,
              usageNeedsConfig: prev.install.usageNeedsConfig,
              readmeSummary: prev.readmeSummary,
              installParsed: {
                commands: prev.install.commands ?? [],
                source: prev.install.commandSource ?? "",
              },
              hasSkillMd: prev.type === "skill",
              subdir: null,
              // N2：同上，沿用已收录条目的宿主版本要求
              dshEngines: prev.install.dshEngines ?? null,
              dshEnginesSource: prev.install.dshEnginesSource,
              // REST 逐个确认 = 存在性刚被核实（D5 lastVerifiedAt 写入点之二；之三在扫描命中处）
              lastVerifiedAt: new Date().toISOString(),
            });
          }
          // pushedAt 变了：等下次扫描进池正常重检测，本次不补
        } catch (err) {
          if (err instanceof GithubError && err.status === 404) confirmedGone++; // 仓库确已删除
        }
      });
    }
    console.log(`  [B2] 补回 ${restored}，确认移除 ${confirmedGone}（其余等下次扫描）`);
  }

  stage("[2/5] 特征检测");
  console.log("[3/5] 实用五维评分...");
  const p99 = computeP99Stars(detected.map((d) => d.repo.stargazers_count));
  for (const d of detected) {
    if (d.candidate.sources.includes("restore")) continue; // B2 补回项保留上次评分（readme 未重抓，避免分数失真）
    d.plugin.score = computePracticalScore(
      {
        stars: d.repo.stargazers_count,
        forks: d.repo.forks_count,
        openIssues: d.repo.open_issues_count,
        pushedAt: d.repo.pushed_at,
        hasDescription: Boolean(d.repo.description),
        hasLicense: Boolean(d.repo.license),
        hasHomepage: Boolean(d.repo.homepage),
        topics: d.repo.topics,
        readmeContent: d.readmeContent,
        hasSkillMd: d.hasSkillMd,
        needsConfig: d.plugin.install.needsConfig,
        usageNeedsConfig: d.plugin.install.usageNeedsConfig ?? false,
      },
      p99
    );
  }
  console.log(`  p99 stars = ${p99}`);

  stage("[3/5] 实用五维评分");
  console.log("[3.5/5] 中文化（DeepSeek 增量翻译）...");
  const prevZh = loadPreviousZh();
  // A：持久化翻译缓存——跨天累积；首次/缺 cache 时从上次 plugins.json 播种
  const zhCache = loadZhCache();
  for (const [id, v] of prevZh) {
    if (!zhCache.has(id) && v.descriptionZh) {
      zhCache.set(id, { descriptionZh: v.descriptionZh, tagsZh: v.tagsZh });
    }
  }
  let translated = 0;
  let skipped = 0;
  let retranslated = 0;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const thinkingLevel = process.env.DEEPSEEK_THINKING_LEVEL ?? undefined;

  if (apiKey) {
    // 已知标签清单（约束新翻译优先复用，抑制同义异名）：从已收录插件聚合细分中文标签 top 40
    const knownTags = [
      ...new Set(
        detected
          .filter((d) => d.plugin.descriptionZh) // 已翻译的（含复用）
          .flatMap((d) => d.plugin.tags.filter((t) => /[\u4e00-\u9fff]/.test(t)))
      ),
    ].slice(0, 40);

    const pending = detected.filter((d) => {
      if (d.plugin.descriptionZh) return false; // 本次已有
      const cached = zhCache.get(d.plugin.id);
      if (cached?.descriptionZh) {
        // 第三步「变化量触发」：README 摘要与上次翻译时相比实质大改 → 重翻（让简介不过时）
        if (shouldRetranslate(d.plugin.readmeSummary, cached.summaryKey)) {
          retranslated++;
          return true;
        }
        // 未大改 → 复用历史翻译（含波动回归的插件——A 缓存跨天，不再被当新仓库重翻）
        d.plugin.descriptionZh = cached.descriptionZh;
        for (const t of cached.tagsZh) {
          if (!d.plugin.tags.includes(t)) d.plugin.tags.push(t);
        }
        skipped++;
        return false;
      }
      return true;
    });
    console.log(
      `  pending translate: ${pending.length}（其中大改重翻 ${retranslated}），reused: ${skipped}`
    );

    await runPool(
      pending,
      async (d) => {
        const result = await translateWithDeepSeek(
          {
            name: d.plugin.name,
            description: d.plugin.description,
            readmeSummary: d.plugin.readmeSummary,
            topics: d.plugin.topics,
            knownTags,
          },
          { apiKey, baseURL, model, thinkingLevel }
        );
        if (result) {
          d.plugin.descriptionZh = result.descriptionZh;
          for (const t of result.tagsZh) {
            if (!d.plugin.tags.includes(t)) d.plugin.tags.push(t);
          }
          translated++;
          console.log(`    ✓ ${d.plugin.id} -> ${result.descriptionZh.slice(0, 40)}`);
        }
      },
      5 // LLM 并发保守
    );
    console.log(`  translated: ${translated}, failed: ${pending.length - translated}`);
    // A：把本次全部中文简介写回持久化缓存（新翻译 + 复用 + 播种）+ 摘要指纹，跨天累积
    for (const d of detected) {
      if (d.plugin.descriptionZh) {
        const prev = zhCache.get(d.plugin.id);
        zhCache.set(d.plugin.id, {
          descriptionZh: d.plugin.descriptionZh,
          tagsZh: d.plugin.tags.filter((t) => /[\u4e00-\u9fff]/.test(t)),
          summaryKey: d.plugin.readmeSummary ?? prev?.summaryKey,
        });
      }
    }
    saveZhCache(zhCache);
  } else {
    console.log("  未配置 DEEPSEEK_API_KEY，跳过中文化（仅保留英文）");
  }

  stage("[3.5/5] 中文化");
  console.log("[3.6/5] 标签归一化（合并同义词 + 移除宽泛标签）...");
  if (apiKey) {
    // 读取历史 alias（持久化复用，避免 LLM 输出波动导致合并丢失）
    let prevAlias: Record<string, string> = {};
    try {
      prevAlias = JSON.parse(readFileSync(join(DATA_DIR, "tag-alias.json"), "utf-8")).alias ?? {};
    } catch {
      prevAlias = {};
    }
    // 1) 先应用历史 alias
    const allPlugins = detected.map((d) => d.plugin);
    let histMerged = 0;
    for (const p of allPlugins) {
      const next: string[] = [];
      for (const t of p.tags) {
        const target = prevAlias[t];
        if (target && target !== t) {
          histMerged++;
          if (!next.includes(target)) next.push(target);
        } else {
          next.push(t);
        }
      }
      p.tags = next;
    }
    // 2) 再跑 LLM 归一化（针对剩余标签，含宽泛移除；归一化用独立模型配置，默认保持 v4-flash）
    const normModel = process.env.DEEPSEEK_NORM_MODEL ?? "deepseek-v4-flash";
    const norm = await normalizeTags(allPlugins, { apiKey, baseURL, model: normModel });
    const aliasEntries = Object.entries(norm.alias);
    console.log(
      `  历史 alias 应用 ${histMerged} 处 · 新 LLM 合并 ${aliasEntries.length} 组（${norm.mergedCount} 处）· 移除宽泛标签 ${norm.removedGeneric} 处`
    );
    // 3) 持久化合并后的 alias
    const mergedAlias = { ...prevAlias, ...norm.alias };
    writeFileSync(
      join(DATA_DIR, "tag-alias.json"),
      JSON.stringify({ updatedAt: new Date().toISOString(), alias: mergedAlias }, null, 2),
      "utf-8"
    );
  } else {
    console.log("  跳过（无 API key）");
  }

  stage("[3.6/5] 标签归一化");
  console.log("[3.7/5] 整合包收集...");
  // 产品决策（2026-08-16）：生态尚无标准协议与工具，自动扫描暂缓。
  // 基础设施（schema v2 / Web 分区 / 插件端 Tab / 提交 issue 通道）已就绪，
  // 设环境变量 DSH_PACK_SCAN=1 启用扫描（协议 dsh.pack.json 与 dsh-bundler 落地后默认开启）。
  const packs: DshPack[] =
    process.env.DSH_PACK_SCAN === "1"
      ? await (async () => {
          const packIssueRepos = await fetchPackSubmissionRepos();
          return collectPacks(
            detected.map((d) => ({ id: d.plugin.id, fullName: d.plugin.fullName })),
            p99,
            [...packIssueRepos.keys()]
          );
        })()
      : [];
  if (process.env.DSH_PACK_SCAN === "1") {
    console.log(`  整合包扫描已启用：${packs.length} 个`);
  } else {
    console.log("  整合包扫描暂缓（设 DSH_PACK_SCAN=1 启用；收到人工提交时见 data/packs.json 手工通道）");
  }
  // 整合包中文化（增量：复用上次结果，packs 少直接顺序翻译）
  if (apiKey && packs.length > 0) {
    let prevPacks: DshPack[] = [];
    try {
      prevPacks = JSON.parse(readFileSync(join(DATA_DIR, "packs.json"), "utf-8")).packs ?? [];
    } catch {
      prevPacks = [];
    }
    const prevZh = new Map(prevPacks.map((p) => [p.id, p.descriptionZh]));
    const knownPackTags = [
      ...new Set(packs.flatMap((p) => p.tags.filter((t) => /[\u4e00-\u9fff]/.test(t)))),
    ].slice(0, 30);
    let translated = 0;
    for (const pack of packs) {
      const prev = prevZh.get(pack.id);
      if (prev) {
        pack.descriptionZh = prev;
        continue;
      }
      const result = await translateWithDeepSeek(
        {
          name: pack.name,
          description: pack.description,
          readmeSummary: pack.readmeSummary,
          topics: pack.tags,
          knownTags: knownPackTags,
        },
        { apiKey, baseURL, model, thinkingLevel }
      );
      if (result) {
        pack.descriptionZh = result.descriptionZh;
        for (const t of result.tagsZh) {
          if (!pack.tags.includes(t)) pack.tags.push(t);
        }
        translated++;
        console.log(`    ✓ pack ${pack.id} -> ${result.descriptionZh.slice(0, 40)}`);
      }
    }
    console.log(`  packs translated: ${translated}`);
  }

  stage("[3.7/5] 整合包收集");
  console.log("[4/5] 生成数据文件...");
  const market: MarketData = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    plugins: detected.map((d) => d.plugin),
    packs,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "plugins.json"), JSON.stringify(market, null, 2), "utf-8");
  // 瘦身索引：插件端只需要一部分字段，全量索引 gzip 已 ~2.8 MB，插件端每个进程首次
  // 打开面板都要拉一遍（实测 6-8s）。这里额外产出一份裁剪版供插件端优先使用
  // （缺字段判据与安全网见 plugin/core/src/lite.ts）。Web 端仍读全量 plugins.json。
  const lite = toLiteMarketData(market);
  writeFileSync(join(DATA_DIR, "plugins-lite.json"), JSON.stringify(lite), "utf-8");
  console.log(
    `  plugins-lite.json: ${lite.plugins.length} plugins` +
      `（${(JSON.stringify(lite).length / 1048576).toFixed(2)} MB vs 全量 ${(JSON.stringify(market).length / 1048576).toFixed(2)} MB）`
  );
  // 独立 packs 数据文件（Web 单独加载，schemaVersion 1）：
  // 扫描关闭时不覆盖——data/packs.json 由人工通道（scripts/pack-add.ts）维护，
  // 每日管道只负责把已提交的文件同步到 web/public 并部署。
  if (process.env.DSH_PACK_SCAN === "1") {
    writeFileSync(
      join(DATA_DIR, "packs.json"),
      JSON.stringify({ schemaVersion: 1, generatedAt: market.generatedAt, packs }, null, 2),
      "utf-8"
    );
  } else {
    console.log("  保留人工 data/packs.json（扫描关闭，不覆盖人工收录的整合包）");
  }
  writeFileSync(
    join(DATA_DIR, "report.json"),
    JSON.stringify(
      {
        generatedAt: market.generatedAt,
        total: market.plugins.length,
        byType: market.plugins.reduce<Record<string, number>>((acc, p) => {
          acc[p.type] = (acc[p.type] ?? 0) + 1;
          return acc;
        }, {}),
        bySource: Object.entries(
          market.plugins.reduce<Record<string, number>>((acc, p) => {
            for (const s of p.sources) acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          }, {})
        ),
        packs: packs.map((p) => ({
          id: p.id,
          entries: p.entryStats.total,
          ok: p.entryStats.ok,
          inMarket: p.entryStats.inMarket,
          score: p.score.total,
        })),
        p99Stars: p99,
        top10: [...market.plugins]
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
          .map((p) => ({
            id: p.id,
            score: p.score.total,
            stars: p.stars,
            explanation: p.score.explanation,
          })),
        rejectedCount: rejected.length,
        rejected: rejected.slice(0, 30),
      },
      null,
      2
    ),
    "utf-8"
  );

  // 提交插件 issue 自动回复清单：收录成功的 issue-submission 来源插件
  // workflow 的回复步骤读取本文件，对每个 issue 评论"已收录"并关闭
  const issueReplies = detected
    .filter((d) => d.candidate.issueNumbers?.length)
    .map((d) => ({
      issueNumbers: d.candidate.issueNumbers!,
      fullName: d.plugin.fullName,
      type: d.plugin.type,
      stars: d.plugin.stars,
      score: d.plugin.score?.total ?? null,
    }));
  if (issueReplies.length > 0) {
    writeFileSync(
      join(DATA_DIR, "issue-replies.json"),
      JSON.stringify({ generatedAt: market.generatedAt, replies: issueReplies }, null, 2),
      "utf-8"
    );
    console.log(`  issue-replies: ${issueReplies.length} 条（待 workflow 自动回复）`);
  } else {
    console.log("  issue-replies: 无（无待回复的 issue 收录）");
  }

  stage("[4/5] 生成数据文件");
  console.log("[5/5] 完成");
  const totalEl = Math.round((Date.now() - stageT0) / 1000);
  console.log(`  ⏱ 管道总用时 ${totalEl}s`);
  const top5 = [...market.plugins]
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 5)
    .map((p) => `${p.id}(${p.score.total})`)
    .join(", ");
  console.log(`  plugins.json: ${market.plugins.length} plugins`);
  // N2 · 宿主版本要求覆盖率（可观测性）：这个字段是**增量补全**的——
  // 只在"仓库有推送"或"检测缓存 7 天 TTL 过期"的条目上写入，不做全量回填。
  // 日志把覆盖率打出来，才能一眼看出它有没有在爬升（否则又是一个"以为在跑其实没跑"的静默失败）。
  const withEngines = market.plugins.filter((p) => p.install?.dshEngines).length;
  const bySource = market.plugins.reduce<Record<string, number>>((acc, p) => {
    const s = p.install?.dshEnginesSource;
    if (s) acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const pct = market.plugins.length ? ((withEngines / market.plugins.length) * 100).toFixed(1) : "0.0";
  console.log(
    `  dshEngines 覆盖: ${withEngines}/${market.plugins.length} (${pct}%)` +
      (Object.keys(bySource).length ? ` · 来源 ${JSON.stringify(bySource)}` : ""),
  );
  console.log(`  top5: ${top5}`);
}

main().catch((err) => {
  console.error("collector failed:", err);
  process.exit(1);
});
