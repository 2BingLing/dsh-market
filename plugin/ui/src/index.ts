/**
 * @dsh-market/plugin host half：把 @dsh-market/core 的能力以 JSON RPC 暴露给
 * 浏览器 Client（/market/api，与 dsh-better-sidebar 的 /sidebar/api 同模式）。
 *
 * 通信：POST /market/api { method, args } → { ok, result } | { ok, error }
 * 方法集与 core/src/cli.ts 保持一致（cli 是动态调试通道，这里是正式通道）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  resolveConfig,
  readProfile,
  writeProfile,
  readSettings,
  writeSettings,
  fetchMarketData,
  fetchPacksData,
  scanInstalled,
  updateProfile,
  recommend,
  search,
  hotTags,
  aggregateTags,
  installPlugin,
  uninstallPlugin,
  checkUpdates,
  checkSelfUpdate,
  applyUpdate,
  writeMinimumReleaseAge,
  verifyAfterInstall,
  detectPnpmMajor,
  parseBlockedBuilds,
  writeBuildApprovals,
  routeInstall,
  deriveSmokeCommands,
  canonicalCommands,
  learnRecipe,
  listRecipes,
  recordInstallMetric,
  metricSummary,
  parseInstallVerdict,
  fetchCurrentUser,
  fetchStarred,
} from '@dsh-market/core'

export const name = 'dsh-market'

export const inject = ['webServer']

/** 读取插件包与核心库版本（设置页「关于」显示） */
const require = createRequire(import.meta.url)
function readVersions(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pkg of ['@dsh-market/plugin', '@dsh-market/core', '@dsh-market/schema']) {
    try {
      out[pkg] = require(`${pkg}/package.json`).version as string
    } catch {
      out[pkg] = 'unknown'
    }
  }
  return out
}

/** webServer service 最小面（与 dsh-better-sidebar 相同形状） */
interface WebRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
interface WebServer {
  register(route: WebRoute): () => void
}

interface RpcRequest {
  method: string
  args?: Record<string, unknown>
}

/** 精简插件字段（与 cli.ts 的 lite 一致，避免 1.3MB 全量过 HTTP） */
function lite(p: any): Record<string, unknown> {
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
  }
}

/** 精简整合包字段（条目 + 解析率 + 评分） */
function litePack(p: any): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    author: p.author,
    descriptionZh: p.descriptionZh,
    tags: p.tags,
    stars: p.stars,
    pushedAt: p.pushedAt,
    curated: p.curated,
    scoreTotal: p.score?.total ?? 0,
    entryStats: p.entryStats ?? { total: 0, ok: 0, failed: 0, inMarket: 0 },
    entries: (p.entries ?? []).map((e: any) => ({
      id: e.id,
      type: e.type,
      version: e.version,
      resolved: e.resolved ?? null,
    })),
  }
}

export function apply(ctx: {
  effect(fn: () => unknown, label?: string): unknown
  webServer: WebServer
  get(name: string): unknown
}): void {
  const cfg = resolveConfig()
  let cached: Awaited<ReturnType<typeof fetchMarketData>> | null = null

  /** 用 settings.json 的 modeOverride 覆盖画像（settings 是用户覆盖的单一来源） */
  function withSettingsMode(profile: ReturnType<typeof readProfile>) {
    if (!profile) return null
    const s = readSettings(cfg)
    return { ...profile, modeOverride: s.modeOverride ?? profile.modeOverride }
  }

  async function market() {
    if (!cached) cached = await fetchMarketData(cfg)
    return cached.data
  }

  async function dispatch(method: string, args: RpcRequest['args'] = {}) {
    switch (method) {
      case 'config':
        return {
          skillsDir: cfg.skillsDir,
          profilesDir: cfg.profilesDir,
          dataDir: cfg.dataDir,
          defaultProfile: cfg.defaultProfile,
          remoteUrl: cfg.remoteUrl,
          versions: readVersions(),
        }
      case 'settings':
        return readSettings(cfg)
      case 'settings:update':
        writeSettings(cfg, (args.patch ?? {}) as { modeOverride?: 'auto' | 'novice' | 'veteran'; profile?: string })
        return readSettings(cfg)

      case 'data': {
        const r = args.refresh ? await fetchMarketData(cfg) : cached ?? await fetchMarketData(cfg)
        if (args.refresh) cached = r
        return { source: r.source, generatedAt: r.data.generatedAt, count: r.data.plugins.length }
      }
      case 'plugins':
        return (await market()).plugins.map(lite)
      case 'plugin:get': {
        const data = await market()
        return data.plugins.find((p) => p.id === args.pluginId) ?? null
      }

      // 整合包通道（packs.json；失败返回空数组）
      case 'packs':
        return (await fetchPacksData(cfg)).map(litePack)
      case 'pack:get': {
        const packs = await fetchPacksData(cfg)
        return packs.find((p) => p.id === args.packId) ?? null
      }

      case 'installed':
        return (await market()).plugins && scanInstalled(cfg, await market()).map((i) => ({
          ...i,
          plugin: i.plugin ? lite(i.plugin) : null,
        }))

      // 已装插件更新检测（npm registry / GitHub pushedAt；force 绕过缓存）
      case 'update:check': {
        const data = await market()
        const installed = scanInstalled(cfg, data)
        return checkUpdates(cfg, installed, { force: Boolean(args.force) })
      }

      // 插件自身更新检测（打开面板自动调用，force 强制刷新）。
      // apply = 引导式（不就地执行）：更新"插件市场自身"不能在运行中的 harness 内覆盖自己
      //（Windows 上文件占用/EPERM 必然卡），直接给出停 harness 后的命令行，杜绝卡死。
      case 'update:self': {
        const versions = readVersions()
        const current = versions['@dsh-market/plugin']
        if (!current) throw new Error('无法读取当前插件版本')
        const check = await checkSelfUpdate(current, { force: Boolean(args.force) })
        if (!args.apply) return check
        const profile = readSettings(cfg).profile
        const manualCommand = `dsh plugin --profile ${profile} add @dsh-market/plugin@latest`
        return {
          ...check,
          applied: false,
          needsManual: true,
          manualCommand,
          reason: `更新插件市场自身需要在停止 harness 后执行（运行中就地覆盖会被文件占用拦截）：\n${manualCommand}\n然后重启 harness。`,
        }
      }

      case 'profile:read':
        return withSettingsMode(readProfile(cfg))
      case 'profile:update': {
        const data = await market()
        const prev = readProfile(cfg)
        const profile = updateProfile(prev, data.plugins, {
          installed: args.installed as never,
          starredFullNames: args.starredFullNames as string[] | undefined,
          quizTags: args.quizTags as string[] | undefined,
        })
        writeProfile(cfg, profile)
        return withSettingsMode(readProfile(cfg))
      }
      case 'profile:reset': {
        writeProfile(cfg, {
          tags: {},
          sources: { installed: [], starred: [], quiz: [], installedPluginIds: [] },
          confidence: 0,
          modeOverride: 'auto',
          updatedAt: new Date().toISOString(),
        })
        return readProfile(cfg)
      }

      case 'search': {
        const data = await market()
        return search(data.plugins, String(args.query ?? ''), args.options as never).map((r) => ({
          plugin: lite(r.plugin),
          relevance: r.relevance,
          tagHits: r.tagHits,
        }))
      }
      case 'tags:hot':
        return hotTags((await market()).plugins, (args.n as number) ?? 12)
      case 'tags:all':
        return aggregateTags((await market()).plugins)

      // 场景推荐信号：当前会话标题 + 最近用户消息 + 最近工具调用 → 匹配插件标签（零 token）
      case 'scene:context': {
        const agents = ctx.get('agents') as
          | { list?: () => Array<{ sessionId?: string; id?: string }> }
          | undefined
        const agent = agents?.list?.()?.[0]
        const sessionId = agent?.sessionId ?? agent?.id
        const sq = ctx.get('sessionQuery') as
          | {
              readTitle?(id: string): Promise<{ title?: string } | undefined>
              readSession?(id: string): Promise<{ events?: Array<Record<string, any>> }>
            }
          | undefined
        if (!sessionId || !sq) return { sceneTags: [], sceneText: '' }
        let title = ''
        const msgs: string[] = []
        const tools: string[] = []
        try {
          const t = await sq.readTitle?.(sessionId)
          title = t?.title ?? ''
          const s = await sq.readSession?.(sessionId)
          const evts = s?.events ?? []
          for (const e of evts.slice(-60)) {
            if (e.type === 'user/message') {
              const txt = (e.data?.content ?? [])
                .filter((c: { type?: string }) => c.type === 'text')
                .map((c: { text?: string }) => c.text ?? '')
                .join(' ')
              if (txt) msgs.push(txt)
            } else if (e.type === 'tool/call') {
              const n = e.data?.name
              if (typeof n === 'string') tools.push(n)
            }
          }
        } catch {
          /* 会话读取失败 → 空场景 */
        }
        const text = [title, ...msgs.slice(-4), ...tools.slice(-8)].join(' ')
        const data = await market()
        const sceneTags = extractSceneTags(text, data.plugins)
        return { sceneTags, sceneText: text.slice(0, 200) }
      }

      // 语义搜索：本地宽松召回候选 → LLM 理解用户需求直接选品精排（带理由）
      // harness 独有能力：搜索"我想干嘛"而非"标签/关键词"
      case 'search:semantic': {
        const query = String(args.query ?? '').trim()
        if (!query) return { picks: [], results: [] }
        const llm = ctx.get('llm') as
          | { stream(opts: Record<string, unknown>): AsyncIterable<{ text?: string; delta?: string }> }
          | undefined
        if (!llm) throw new Error('LLM 服务不可用')
        const data = await market()
        // 1. 本地宽松预召回（Fuse + 子串，候选池固定 60，token 预算不随插件量增长）
        const candidates = search(data.plugins, query, { limit: 60 })
        if (candidates.length === 0) return { picks: [], results: [] }
        // 2. LLM 精排：理解自然语言需求，从候选里挑最匹配的
        const lines = candidates.map((c, i) => {
          const zhTags = c.plugin.tags.filter((t) => /[\u4e00-\u9fff]/.test(t)).slice(0, 4).join('/')
          return `${i}. ${c.plugin.name}｜${(c.plugin.descriptionZh ?? '').slice(0, 60)}｜${zhTags}`
        })
        const prompt = [
          '你是 DSH 插件市场的选品助手。用户的需求描述：「' + query + '」',
          '候选插件（编号. 名称｜中文简介｜中文标签）：',
          ...lines,
          '任务：从候选中选出最符合用户需求的插件（最多 20 个，按匹配度从高到低排序）。',
          '只输出 JSON：{"picks":[{"i":编号,"reason":"为什么适合（20 字内）"}]}，不要输出其他文字。',
        ].join('\n')
        let text = ''
        try {
          const stream = llm.stream({
            provider: 'opencode-go',
            model: 'deepseek-v4-flash',
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          })
          for await (const chunk of stream) {
            const t = chunk && (chunk.text ?? chunk.delta ?? null)
            if (typeof t === 'string') text += t
          }
        } catch (e) {
          console.error('semantic search llm failed:', e)
        }
        const picks = parsePicks(text)
        const results = (picks.length > 0 ? picks : candidates.slice(0, 20).map((c, i) => ({ i, reason: '' })))
          .map((p) => {
            const c = candidates[p.i]
            if (!c) return null
            return {
              plugin: lite(c.plugin),
              relevance: c.relevance,
              tagHits: c.tagHits,
              aiReason: p.reason,
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
        return { picks, results }
      }

      case 'recommend': {
        const data = await market()
        const profile = withSettingsMode(readProfile(cfg)) ?? updateProfile(null, data.plugins, {})
        return recommend(data.plugins, profile, args.options as never).map((r) => ({
          plugin: lite(r.plugin),
          score: r.score,
          relevance: r.relevance,
          reasons: r.reasons,
          origin: r.origin,
        }))
      }

      case 'install': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        const profile = (args.targetProfile as string) ?? readSettings(cfg).profile
        // P1 冒烟验证：装后检查真实落位（skill 目录/SKILL.md；cordis profile 依赖）
        const smoke = deriveSmokeCommands(cfg, plugin, profile)
        const r = await installPlugin(cfg, plugin, {
          dryRun: Boolean(args.dryRun),
          force: Boolean(args.force),
          targetProfile: profile,
          runner: realRunner(),
          smoke,
        })
        // P1 配方学习：真实安装 + 冒烟通过 → 沉淀配方（后续 AI 安装/重装零 token 直装）
        if (r.ok && !r.alreadyInstalled && !args.dryRun && !r.smokeFailed) {
          learnRecipe(cfg, plugin, profile, {
            commands: canonicalCommands(cfg, plugin, profile),
            smoke,
            learnedFrom: 'parsed',
          })
        }
        // P1.5 度量：一键安装事件（T0 命中率分母的一部分）
        recordInstallMetric(cfg, {
          ts: new Date().toISOString(),
          pluginId: plugin.id,
          type: 'install',
          mode: 'direct',
          ok: r.ok,
          alreadyInstalled: r.alreadyInstalled,
          smokeFailed: r.smokeFailed,
          recipeLearned: Boolean(r.ok && !r.alreadyInstalled && !args.dryRun && !r.smokeFailed),
        })
        // P0-1 装后四态验证：真实安装成功后附带 activation（dryRun / 已装跳过时不附）
        if (r.ok && !r.alreadyInstalled && !args.dryRun) {
          r.activation = verifyAfterInstall(cfg, plugin, { profile })
        }
        // P0-2 构建脚本被拦：从失败信息中解析被拦包名（UI 弹出"批准并重试"）
        if (!r.ok) {
          const blocked = parseBlockedBuilds(r.error ?? '')
          if (blocked.length > 0) (r as { blockedBuilds?: string[] }).blockedBuilds = blocked
        }
        return r
      }
      // P0-1 装后四态验证（"已装"tab 逐项确认 / 手动触发）
      case 'verify': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        return verifyAfterInstall(cfg, plugin, {
          profile: (args.targetProfile as string) ?? readSettings(cfg).profile,
        })
      }
      // P0-3 更新执行：before/after 对比，假更新防误报
      case 'update:apply': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        const item =
          scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId) ?? {
            pluginId: args.pluginId as string,
            localName: (args.localName as string) ?? plugin.name,
            version: null,
            source: 'profile',
            plugin,
          }
        return applyUpdate(cfg, plugin, item, {
          runner: realRunner(),
          profile: (args.targetProfile as string) ?? readSettings(cfg).profile,
        })
      }
      // P0-3 放宽 pnpm 发布年龄门槛（minimumReleaseAge: 0）——被门槛挡住时一键处理
      case 'update:relax': {
        const profile = (args.profile as string) ?? readSettings(cfg).profile
        return writeMinimumReleaseAge(join(cfg.profilesDir, profile), 0)
      }
      // P0-2 构建脚本放行：写 pnpm-workspace.yaml（allowBuilds/onlyBuiltDependencies），保留原内容
      case 'builds:approve': {
        const profile = (args.profile as string) ?? readSettings(cfg).profile
        const profileDir = join(cfg.profilesDir, profile)
        const major = await detectPnpmMajor({ runner: realRunner(), cwd: profileDir })
        return writeBuildApprovals(profileDir, (args.packages as string[]) ?? [], {
          pnpmMajor: major,
        })
      }
      case 'uninstall': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        // 传已装项的 localName（依赖键名/目录名）——pnpm remove 对键名大小写敏感，
        // plugin.name 是 GitHub 原始大小写（如 DSH-better-sidebar），直接推断会卸载失败
        const item = scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId)
        return uninstallPlugin(cfg, plugin, {
          targetProfile: (args.targetProfile as string) ?? readSettings(cfg).profile,
          runner: realRunner(),
          localName: item?.localName,
        })
      }

      // AI 代理安装（路由式）：T0（零 LLM：已装 / 配方 / 解析命令）先行，
      // 只有需要才派协议子代理（T1 极简安装执行器）。
      // security=true（安全模式，2026-09 新增）：跳过 T0 直装，强制 AI 扫描 + 安装
      // ——针对 DSH 供应链漏洞（QVD-2026-57410 CVSS 9.8 等）的防御选项。
      case 'ai:install': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        const profile = (args.targetProfile as string) ?? readSettings(cfg).profile
        const security = Boolean(args.security)
        const t0 = security
          ? null
          : await routeInstall(cfg, plugin, {
              profile,
              runner: realRunner(),
              force: Boolean(args.force),
            })
        // T0 已搞定：零 token，不需要子代理（安全模式下跳过 T0，不走这里）
        if (!security && t0 && !t0.needAi) {
          recordInstallMetric(cfg, {
            ts: new Date().toISOString(),
            pluginId: plugin.id,
            type: 'ai',
            // needAi=false 时 t0.mode 不可能为 'ai'
            mode: t0.mode as "already" | "recipe" | "parsed" | "builtin",
            ok: t0.ok,
            alreadyInstalled: t0.alreadyInstalled,
            smokeFailed: t0.result?.smokeFailed ?? false,
            error: t0.result?.error ?? null,
          })
          return {
            started: false,
            childSessionId: null,
            mode: t0.mode,
            ok: t0.ok,
            alreadyInstalled: t0.alreadyInstalled ?? false,
            smokeFailed: t0.result?.smokeFailed ?? false,
            error: t0.result?.error ?? null,
          }
        }
        const agents = ctx.get('agents') as { list?: () => Array<{ sessionId?: string; id?: string }> } | undefined
        const subagents = ctx.get('subagents') as
          | {
              list(): string[]
              start(
                name: string,
                request: {
                  label?: string
                  prompt: Array<{ type: string; text: string }>
                  parent: unknown
                  signal: AbortSignal
                },
              ): Promise<{ sessionId?: string; id?: string }>
            }
          | undefined
        if (!subagents) throw new Error('子代理服务不可用')
        const agent = agents?.list?.()?.[0]
        if (!agent) throw new Error('当前会话代理不可用')
        const provider = subagents.list().includes('spawn') ? 'spawn' : subagents.list()[0]
        const prompt = buildInstallPrompt(plugin, profile, t0?.reason, { security })
        // start 的 promise 在 run 发布后 fulfill；只等发布（10s 超时保护）
        const run = await Promise.race([
          subagents.start(provider, {
            label: `安装 ${plugin.name}`,
            prompt: [{ type: 'text', text: prompt }],
            parent: agent,
            signal: AbortSignal.timeout(10 * 60 * 1000),
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('子代理启动超时')), 10000),
          ),
        ])
        const sessionId = run.sessionId ?? run.id ?? null
        // P1.5 度量：升级子代理
        recordInstallMetric(cfg, {
          ts: new Date().toISOString(),
          pluginId: plugin.id,
          type: 'ai',
          mode: 't1',
          ok: false,
          phase: 'start',
          error: t0.reason ?? null,
        })
        // P1.5 T1 输出自动落库（后台，不阻塞 RPC）：轮询子会话 → JSON verdict → 学配方 + 完成度量
        if (sessionId) {
          const sq = ctx.get('sessionQuery') as
            | { readSession?(id: string): Promise<{ events?: Array<Record<string, any>> } | undefined> }
            | undefined
          if (sq?.readSession) {
            void watchInstallVerdict({
              cfg,
              plugin,
              profile,
              sessionId,
              readSession: sq.readSession,
            })
          }
        }
        return {
          started: true,
          childSessionId: sessionId,
          mode: 't1',
          reason: t0?.reason ?? null,
          security,
        }
      }

      // 配方缓存（T0 的"学习成果"）：透明列表 + 手动学习（T1 验证后落库 / 用户修正）
      case 'recipe:list':
        return listRecipes(cfg)
      case 'recipe:save': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        const commands = args.commands as string[] | undefined
        if (!commands || commands.length === 0) throw new Error('缺少 commands')
        learnRecipe(cfg, plugin, (args.targetProfile as string) ?? readSettings(cfg).profile, {
          commands,
          smoke: args.smoke as string[] | undefined,
          config: args.config as never,
          learnedFrom: (args.learnedFrom as 't1' | 't2') ?? 't1',
        })
        return { ok: true }
      }

      // 安装路由度量（设计稿 §10）：T0 命中率 / AI 参与率 / 成功率 / T1 会话量代理
      case 'metrics:summary':
        return metricSummary(cfg)

      case 'gh:deviceCode': {
        const r = await fetch('https://github.com/login/device/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'dsh-market' },
          body: JSON.stringify(args.body ?? {}),
          signal: AbortSignal.timeout(15000),
        })
        return r.json()
      }
      case 'gh:token': {
        const r = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'dsh-market' },
          body: JSON.stringify(args.body ?? {}),
          signal: AbortSignal.timeout(15000),
        })
        return r.json()
      }
      case 'gh:user': {
        if (!args.token) throw new Error('no token')
        return fetchCurrentUser(String(args.token))
      }
      case 'gh:starred':
        return fetchStarred({
          token: args.token as string | undefined,
          username: args.username as string | undefined,
        })
      // 加星/取消加星（需 PAT 类 token；GitHub App 设备流 token 不支持此端点）
      case 'gh:star': {
        const { token, owner, repo, action } = args as {
          token?: string
          owner?: string
          repo?: string
          action?: string
        }
        if (!token) throw new Error('未绑定 GitHub')
        if (!owner || !repo) throw new Error('缺少 owner/repo')
        const method = action === 'unstar' ? 'DELETE' : 'PUT'
        const r = await fetch(
          `https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': 'dsh-market',
              'Content-Length': '0',
            },
            signal: AbortSignal.timeout(15000),
          },
        )
        if (!r.ok) {
          const body = await r.text().catch(() => '')
          throw new Error(`GitHub star ${r.status}: ${body.slice(0, 200)}`)
        }
        return { ok: true }
      }

      default:
        throw new Error(`未知方法: ${method}`)
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/market/api',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }
        try {
          const payload = (await readJsonBody(req)) as RpcRequest
          const result = await dispatch(payload.method, payload.args)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, result }))
        } catch (err) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
        }
      },
    }),
    'dsh-market: /market/api routes',
  )
}

/** 读取 JSON 请求体 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** 从会话文本提取场景标签（零 token：子串匹配插件标签/插件名） */
function extractSceneTags(text: string, plugins: Array<{ name: string; tags: string[] }>): string[] {
  const lower = text.toLowerCase()
  const hits = new Map<string, number>()
  for (const p of plugins) {
    // 插件名命中（工具名/skill 名/仓库名出现在会话中）→ 该插件的中文标签加权
    const nameHit = p.name && lower.includes(p.name.toLowerCase())
    for (const t of p.tags) {
      if (t.length < 2) continue
      if (lower.includes(t.toLowerCase())) {
        hits.set(t, (hits.get(t) ?? 0) + (nameHit ? 2 : 1))
      }
    }
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)
}

/** 容错解析 LLM 输出的选品 JSON：{"picks":[{"i":编号,"reason":"..."}]} */
function parsePicks(text: string): Array<{ i: number; reason: string }> {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const obj = JSON.parse(m[0]) as { picks?: unknown }
    if (!Array.isArray(obj.picks)) return []
    return obj.picks
      .filter((p): p is { i?: unknown; reason?: unknown } => typeof p === 'object' && p !== null)
      .map((p) => ({ i: Number(p.i), reason: typeof p.reason === 'string' ? p.reason.slice(0, 30) : '' }))
      .filter((p) => Number.isInteger(p.i) && p.i >= 0)
      .slice(0, 20)
  } catch {
    return []
  }
}

/** 生成 AI 安装任务的子代理提示词（路由协议 T1：极简安装执行器）。
 *  协议而非散文：固定步骤 + 禁止清单 + 严格 JSON 输出，最小 token 完成安装。
 *  security=true（安全模式）：安装前先做供应链安全检查，发现风险先报告不安装。 */
function buildInstallPrompt(
  plugin: {
    name: string
    fullName: string
    type: string
    descriptionZh: string | null
    install: { method?: string; commands?: string[]; needsConfig?: boolean; target?: string }
    stars: number
  },
  targetProfile: string,
  reason?: string,
  opts?: { security?: boolean },
): string {
  const cmdLine =
    plugin.install.commands && plugin.install.commands.length > 0
      ? plugin.install.commands.join('\n    ')
      : '(无)'
  const security = opts?.security === true
  const securitySection = security
    ? [
        ``,
        `【⛔ 安全模式：安装前必须先扫描（2026-09 新增，针对 DSH 供应链漏洞 QVD-2026-57410 等）】`,
        `在【协议】第 1 步执行命令**之前**，先完成以下安全检查：`,
        `1. 读插件仓库 README 全文关键段 + 安装用的脚本/清单（cordis.patch.yml / dsh.bundle / install.sh / package.json 等），逐个核对：`,
        `   a. 安装命令是否有危险模式：curl|sh、wget 后立即执行、下载二进制执行、base64 解码后执行、从不可信 URL 拉取代码；`,
        `   b. 是否收集/回传敏感信息：读取 API Key / Token / 环境变量（GITHUB_TOKEN、DEEPSEEK_API_KEY、OPENAI_API_KEY 等）并发送到外部地址；`,
        `   c. 是否篡改配置：patch 覆盖 harness 自身配置（sandbox/approval/权限）或把自身混入系统目录；`,
        `   d. 来源信号：仓库年龄与维护活跃、star 量级、是否近期新建（<30 天且低活跃的高危）；`,
        `2. 结论必须明确：`,
        `   - 无风险 → 继续按【协议】安装；`,
        `   - 发现可疑（危险命令 / 信息收集 / 配置篡改 / 来源存疑）→ **立即停止**：不执行任何命令，输出 {"ok":false,"security_blocked":true,"reason":"<具体风险描述>"} 并结束。`,
        `3. 需要配置时（协议第 5 条触发）：确认配置只写入本机（环境变量 / profile），不发送到任何外部地址。`,
        `4. 安装完成后把扫描要点与结论写入 recipe 的 "security" 字段（无风险也写 "no risk detected"）。`,
      ].join('\n')
    : []
  return [
    `你是「极简安装执行器」，安装 DSH 插件「${plugin.name}」（${plugin.fullName}）。只做安装，不做别的。${security ? '本次为【安全模式】。' : ''}`,
    ``,
    `【插件信息】`,
    `- 类型：${plugin.type === 'skill' ? 'skill（技能）' : 'cordis 插件'}（${plugin.type}）`,
    `- 简介：${plugin.descriptionZh ?? '(无中文简介)'}`,
    `- 需要配置：${plugin.install.needsConfig ? '是（API Key / Token 等）' : '否'}`,
    `- 目标 profile：${targetProfile}`,
    `- 参考命令（collector 已从 README 解析，优先直接使用）：`,
    `    ${cmdLine}`,
    ...(reason ? [`- 前序尝试（T0 已失败，仅作线索，不要重复踩坑）：${reason}`] : []),
    ...securitySection,
    ``,
    `【协议（必须遵守）】`,
    `1. 先执行参考命令（可做最少修正：包管理器 / 平台差异）。不要先读 README。${security ? '【安全模式下：先完成上方扫描，再执行本条】' : ''}`,
    `2. 命令缺失或明显错误时：只读仓库 README 的安装段落（grep install/安装/代码块，前 200 行），禁止全文阅读。`,
    `3. 执行后必须验证：${plugin.type === 'skill' ? '技能目录存在且含 SKILL.md' : `profile「${targetProfile}」的 package.json 的 dependencies 含包名`}；exit 0 且验证通过才算成功。`,
    `4. 失败时：重试 1 次 → 用错误文本 grep README → 仍失败则如实放弃并报告，不要无限尝试。`,
    `5. 需要配置（API Key/Token/环境变量）时：只填 config_needed，不猜测、不伪造、不自行写入；先停下向用户确认。`,
    `6. 全程禁止：思考过程、解释、总结散文、阅读文档其余部分、搜索网络（除非 README 明确引用必要的安装文档）。`,
    ``,
    `【输出】严格 JSON，无其他文本：`,
    `{"ok":true|false,"commands":["实际执行的命令"],"smoke":["执行并验证的命令"],"fail":"失败与已尝试方案（失败时）","config_needed":null|{"what":"需要什么配置","hint":"在哪获取"},"recipe":{"commands":["可用安装命令"],"smoke":["验证命令"]}${security ? `,"security_blocked":false|true,"security_reason":"安全扫描结论或风险描述"` : ''}}`,
  ].join('\n')
}

/** T1 子代理验收（后台，不阻塞 RPC）：轮询子会话输出 → 解析 JSON verdict →
 *  ok 且带命令 → 学配方（learnedFrom=t1，含 config_needed）；记录完成度量（sessionChars 为 token 粗略代理）。
 *  终止条件：拿到 verdict（成功或失败）→ 停止；否则轮询到 10 分钟上限。 */
async function watchInstallVerdict(opts: {
  cfg: ReturnType<typeof resolveConfig>
  plugin: Awaited<ReturnType<typeof fetchMarketData>>['data']['plugins'][number]
  profile: string
  sessionId: string
  readSession: (id: string) => Promise<{ events?: Array<Record<string, any>> } | undefined>
}): Promise<void> {
  const { cfg, plugin, profile, sessionId, readSession } = opts
  const deadline = Date.now() + 10 * 60 * 1000
  let chars = 0
  const tick = async () => {
    let done = false
    try {
      const s = await readSession(sessionId)
      const text = collectSessionText(s?.events ?? [])
      chars = Math.max(chars, text.length)
      const verdict = parseInstallVerdict(text)
      if (verdict && verdict.ok && verdict.commands && verdict.commands.length > 0) {
        const recipe = verdict.recipe ?? { commands: verdict.commands, smoke: verdict.smoke }
        learnRecipe(cfg, plugin, profile, {
          commands: recipe.commands ?? verdict.commands,
          smoke: recipe.smoke,
          ...(verdict.configNeeded?.what
            ? { config: { type: 'env' as const, prompt: verdict.configNeeded.what } }
            : {}),
          learnedFrom: 't1',
        })
        recordInstallMetric(cfg, {
          ts: new Date().toISOString(),
          pluginId: plugin.id,
          type: 'ai',
          mode: 't1',
          ok: true,
          phase: 'done',
          recipeLearned: true,
          sessionChars: chars,
        })
        done = true
      } else if (verdict && verdict.ok === false) {
        recordInstallMetric(cfg, {
          ts: new Date().toISOString(),
          pluginId: plugin.id,
          type: 'ai',
          mode: 't1',
          ok: false,
          phase: 'done',
          sessionChars: chars,
          error: verdict.fail,
        })
        done = true
      }
    } catch {
      /* 会话读取失败：继续轮询 */
    }
    if (!done && Date.now() < deadline) setTimeout(() => void tick(), 5000)
  }
  setTimeout(() => void tick(), 5000)
}

/** 从会话事件里收集全部文本（user/assistant/tool 的 content[i].text 与 data.text/text 字段） */
function collectSessionText(events: Array<Record<string, any>>): string {
  const parts: string[] = []
  for (const e of events) {
    const content = e?.data?.content
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') {
          parts.push(c.text)
        }
      }
    } else if (typeof e?.data?.text === 'string') {
      parts.push(e.data.text)
    } else if (typeof e?.text === 'string') {
      parts.push(e.text)
    }
  }
  return parts.join('\n')
}

/** 命令执行器：正式包运行在 harness 进程（无 shell 沙箱），可直接管道捕获。
 *  平台适配（issue #78）：Win32 用 cmd.exe，POSIX（macOS/Linux）用 /bin/sh -c。 */
import { execFile } from 'node:child_process'
const isWin = process.platform === 'win32'

function realRunner() {
  return {
    run(command: string, opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }) {
      return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
        const file = isWin ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh'
        const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command]
        execFile(
          file,
          args,
          {
            cwd: opts.cwd,
            timeout: opts.timeoutMs ?? 120000,
            windowsHide: isWin,
            env: opts.env ? { ...process.env, ...opts.env } : undefined,
          },
          (err, stdout, stderr) => {
            if (err) {
              reject(new Error(stderr || stdout || err.message))
              return
            }
            resolve({ exitCode: 0, stdout, stderr })
          },
        )
      })
    },
  }
}
