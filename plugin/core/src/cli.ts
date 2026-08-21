/**
 * 核心层 stdio RPC 服务（CLI 形态）
 * 动态 cordis 插件 Host 无法 import 本地模块，通过 subprocess 调用本入口：
 *   node --import tsx <core>/src/cli.ts
 * 协议：stdin 每行一个 JSON 请求 → stdout 每行一个 JSON 响应
 *   req:  {"id":1,"method":"recommend","args":{...}}
 *   resp: {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":"..."}
 * 正式交付的插件包则直接 import core 模块（不走 CLI）。
 */
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveConfig } from "./config.js";
import { fetchMarketData } from "./data.js";
import { scanInstalled } from "./installed.js";
import { readProfile, writeProfile, readBinding, writeBinding, readSettings, writeSettings } from "./config.js";
import { updateProfile, topTags } from "./profile.js";
import { recommend } from "./recommend.js";
import { search } from "./search.js";
import { hotTags, aggregateTags } from "./tags.js";
import { installPlugin, uninstallPlugin } from "./installer.js";
import { checkUpdates, checkSelfUpdate, applyUpdate, readMinimumReleaseAge, writeMinimumReleaseAge } from "./update.js";
import { verifyAfterInstall } from "./verify.js";
import { detectPnpmMajor, isBuildBlockedFailure, parseBlockedBuilds, writeBuildApprovals } from "./builds.js";
import type { CommandRunner } from "./types.js";
import { fetchCurrentUser, fetchStarred } from "./github.js";

// 真实命令执行器（CLI 形态下直接使用 child_process）。
// 注意：运行在 harness shell 沙箱下时，管道 stdio 的 spawn 会被拦（EPERM），
// 因此使用 stdio: 'ignore' 只取退出码，不捕获输出。
const realRunner: CommandRunner = {
  run(command, opts) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", command],
        { cwd: opts.cwd, windowsHide: true, stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        child.kill();
      }, opts.timeoutMs ?? 120000);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, stdout: "", stderr: "" });
      });
    });
  },
};

const cfg = resolveConfig();
let cachedMarket: Awaited<ReturnType<typeof fetchMarketData>> | null = null;

/** 读取已安装的 @dsh-market/plugin 版本（自更新检测用；core 与 plugin 同装于 profile node_modules） */
const require = createRequire(import.meta.url);
function pluginVersion(): string | null {
  try {
    return require("@dsh-market/plugin/package.json").version as string;
  } catch {
    return null;
  }
}

async function market() {
  if (!cachedMarket) {
    cachedMarket = await fetchMarketData(cfg);
  }
  return cachedMarket.data;
}

/** 精简插件字段（UI 列表用，避免全量 1.3MB 过 RPC） */
function lite(p: any) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    fullName: p.fullName,
    descriptionZh: p.descriptionZh,
    tags: p.tags,
    stars: p.stars,
    pushedAt: p.pushedAt,
    curated: p.curated,
    curatedReason: p.curatedReason,
    scoreTotal: p.score?.total ?? 0,
    needsConfig: p.install?.needsConfig ?? false,
    installMethod: p.install?.method,
    installCommands: p.install?.commands ?? [],
    installTarget: p.install?.target,
  };
}

const litePlugin = (p: any) => lite(p);

/** 用 settings.json 的 modeOverride 覆盖画像（settings 是用户覆盖的单一来源） */
function withSettingsMode(profile: ReturnType<typeof readProfile>) {
  if (!profile) return null
  const s = readSettings(cfg)
  return { ...profile, modeOverride: s.modeOverride ?? profile.modeOverride }
}

const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
  // ---------- 配置 ----------
  config: () => ({
    skillsDir: cfg.skillsDir,
    profilesDir: cfg.profilesDir,
    dataDir: cfg.dataDir,
    defaultProfile: cfg.defaultProfile,
    remoteUrl: cfg.remoteUrl,
  }),
  settings: () => readSettings(cfg),
  "settings:update": (args) => {
    writeSettings(cfg, args.patch);
    return readSettings(cfg);
  },

  // ---------- 数据 ----------
  data: async (args) => {
    const r = await (args?.refresh ? fetchMarketData(cfg) : Promise.resolve(cachedMarket ?? fetchMarketData(cfg)));
    if (args?.refresh) cachedMarket = r;
    return { source: r.source, generatedAt: r.data.generatedAt, count: r.data.plugins.length };
  },
  plugins: () => market().then((d) => d.plugins.map(litePlugin)),
  "plugin:get": async (args) => {
    const data = await market();
    const p = data.plugins.find((x) => x.id === args.pluginId);
    return p ?? null;
  },

  // ---------- 已装 ----------
  installed: () =>
    market().then((d) =>
      scanInstalled(cfg, d).map((i) => ({
        ...i,
        plugin: i.plugin ? litePlugin(i.plugin) : null,
      })),
    ),
  "update:check": (args) =>
    market().then((d) => checkUpdates(cfg, scanInstalled(cfg, d), { force: args?.force })),
  // 插件自身更新检测；apply = 引导式（不就地执行，运行中覆盖自己必卡）
  "update:self": async (args) => {
    const current = pluginVersion();
    if (!current) throw new Error("无法读取当前插件版本");
    const check = await checkSelfUpdate(current, { force: Boolean(args?.force) });
    if (!args?.apply) return check;
    const profile = readSettings(cfg).profile;
    const manualCommand = `dsh plugin --profile ${profile} add @dsh-market/plugin@latest`;
    return {
      ...check,
      applied: false,
      needsManual: true,
      manualCommand,
      reason: `更新插件市场自身需要在停止 harness 后执行（运行中就地覆盖会被文件占用拦截）：\n${manualCommand}\n然后重启 harness。`,
    };
  },

  // ---------- 画像 ----------
  "profile:read": () => withSettingsMode(readProfile(cfg)),
  "profile:update": async (args) => {
    const data = await market();
    const prev = readProfile(cfg);
    const profile = updateProfile(prev, data.plugins, {
      installed: args.installed,
      starredFullNames: args.starredFullNames,
      quizTags: args.quizTags,
    });
    writeProfile(cfg, profile);
    return withSettingsMode(readProfile(cfg));
  },
  "profile:reset": () => {
    writeProfile(cfg, {
      tags: {},
      sources: { installed: [], starred: [], quiz: [], installedPluginIds: [] },
      confidence: 0,
      modeOverride: "auto",
      updatedAt: new Date().toISOString(),
    });
    return withSettingsMode(readProfile(cfg));
  },

  // ---------- 搜索 / 标签 ----------
  search: (args) =>
    market().then((d) =>
      search(d.plugins, args.query, args.options).map((r) => ({
        plugin: litePlugin(r.plugin),
        relevance: r.relevance,
        tagHits: r.tagHits,
      })),
    ),
  "tags:hot": (args) => market().then((d) => hotTags(d.plugins, args.n ?? 12)),
  "tags:all": () => market().then((d) => aggregateTags(d.plugins)),

  // ---------- 推荐 ----------
  recommend: async (args) => {
    const data = await market();
    const profile = withSettingsMode(readProfile(cfg)) ?? updateProfile(null, data.plugins, {});
    return recommend(data.plugins, profile, args.options).map((r) => ({
      plugin: litePlugin(r.plugin),
      score: r.score,
      relevance: r.relevance,
      reasons: r.reasons,
      origin: r.origin,
    }));
  },

  // ---------- 安装 ----------
  install: async (args) => {
    const data = await market();
    const plugin = data.plugins.find((p) => p.id === args.pluginId);
    if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
    const profile = args.targetProfile ?? readSettings(cfg).profile;
    const r = await installPlugin(cfg, plugin, {
      dryRun: args.dryRun ?? false,
      force: args.force ?? false,
      targetProfile: profile,
      runner: realRunner,
    });
    // P0-1 装后四态验证：真实安装成功后附带 activation（dryRun / 已装跳过时不附）
    if (r.ok && !r.alreadyInstalled && !(args.dryRun ?? false)) {
      r.activation = verifyAfterInstall(cfg, plugin, { profile });
    }
    return r;
  },
  // 装后四态验证（用于"已装"tab 逐项确认或手动触发）
  verify: async (args) => {
    const data = await market();
    const plugin = data.plugins.find((p) => p.id === args.pluginId);
    if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
    const profile = args.targetProfile ?? readSettings(cfg).profile;
    return verifyAfterInstall(cfg, plugin, { profile });
  },
  // 更新执行（P0-3 假更新防误报）：before/after 对比 + minimumReleaseAge / HEAD 判定
  "update:apply": async (args) => {
    const data = await market();
    const plugin = data.plugins.find((p) => p.id === args.pluginId);
    if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
    const item =
      scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId) ?? {
        pluginId: plugin.id,
        localName: args.localName ?? plugin.name,
        version: null,
        source: "profile",
        plugin: plugin as never,
      };
    return applyUpdate(cfg, plugin, item as never, {
      runner: realRunner,
      profile: args.targetProfile ?? readSettings(cfg).profile,
    });
  },
  // 放宽 pnpm 发布年龄门槛（minimumReleaseAge: 0），配合假更新防误报的一键处理
  "update:relax": (args) => {
    const profile = args.profile ?? readSettings(cfg).profile;
    return writeMinimumReleaseAge(join(cfg.profilesDir, profile), 0);
  },
  // 构建脚本被拦检测 + 放行（P0-2）
  "builds:detect": () => {
    // cli 调试通道 stdout 不可捕获，构建脚本检测以生产通道（index.ts execFile 捕获）为准
    return { supported: false, note: "cli 调试通道无法捕获 pnpm 输出，前往正式面板使用" };
  },
  "builds:approve": async (args) => {
    const profile = args.profile ?? readSettings(cfg).profile;
    const profileDir = join(cfg.profilesDir, profile);
    const major = await detectPnpmMajor({ runner: realRunner, cwd: profileDir });
    return writeBuildApprovals(profileDir, args.packages ?? [], { pnpmMajor: major });
  },
  uninstall: async (args) => {
    const data = await market();
    const plugin = data.plugins.find((p) => p.id === args.pluginId);
    if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
    // 传已装项 localName（依赖键名/目录名），pnpm remove 对键名大小写敏感
    const item = scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId);
    return uninstallPlugin(cfg, plugin, {
      targetProfile: args.targetProfile ?? readSettings(cfg).profile,
      runner: realRunner,
      localName: item?.localName,
    });
  },

  // ---------- GitHub ----------
  // 设备流端点不支持 CORS，由 Host 代理（token 交换结果回传，由 Client 存 localStorage）
  "gh:deviceCode": (args) => ghPost("https://github.com/login/device/code", args.body),
  "gh:token": (args) => ghPost("https://github.com/login/oauth/access_token", args.body, true),
  "gh:user": async (args) => {
    if (!args.token) throw new Error("no token");
    return fetchCurrentUser(args.token);
  },
  "gh:starred": async (args) => fetchStarred({ token: args.token ?? undefined, username: args.username ?? undefined }),
};

async function ghPost(url: string, body: Record<string, unknown>, acceptJson = false) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: acceptJson ? "application/json" : "application/json",
      "User-Agent": "dsh-market",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

// ---------- 主循环 ----------
let pending = 0;
let stdinClosed = false;

function maybeExit(): void {
  if (stdinClosed && pending === 0) process.exit(0);
}

async function handleRequest(req: { id: number; method: string; args?: any }): Promise<void> {
  try {
    const handler = handlers[req.method];
    if (!handler) throw new Error(`未知方法: ${req.method}`);
    const result = await handler(req.args ?? {});
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + "\n");
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ id: req.id, ok: false, error: (err as Error).message }) + "\n",
    );
  }
}

// argv 单发模式：node cli.ts '<base64-json>' 执行一次并退出（shell.run 桥接用，
// 避免跨 shell 的引号转义问题；以 b64: 前缀标识）
const argvReq = process.argv[2];
if (argvReq) {
  let reqText: string | null = null;
  if (argvReq.startsWith("b64:")) {
    try {
      reqText = Buffer.from(argvReq.slice(4), "base64").toString("utf8");
    } catch {
      reqText = null;
    }
  } else if (argvReq.startsWith("{")) {
    reqText = argvReq;
  }
  if (reqText) {
    try {
      const req = JSON.parse(reqText);
      await handleRequest(req);
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ id: -1, ok: false, error: (err as Error).message }) + "\n",
      );
    }
    process.exit(0);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let req: { id: number; method: string; args?: any };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  pending++;
  void (async () => {
    await handleRequest(req);
    pending--;
    maybeExit();
  })();
});
rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});
