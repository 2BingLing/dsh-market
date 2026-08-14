/**
 * @dsh-market/plugin host half：把 @dsh-market/core 的能力以 JSON RPC 暴露给
 * 浏览器 Client（/market/api，与 dsh-better-sidebar 的 /sidebar/api 同模式）。
 *
 * 通信：POST /market/api { method, args } → { ok, result } | { ok, error }
 * 方法集与 core/src/cli.ts 保持一致（cli 是动态调试通道，这里是正式通道）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  resolveConfig,
  readProfile,
  writeProfile,
  readSettings,
  writeSettings,
  fetchMarketData,
  scanInstalled,
  updateProfile,
  recommend,
  search,
  hotTags,
  aggregateTags,
  installPlugin,
  uninstallPlugin,
  fetchCurrentUser,
  fetchStarred,
} from '@dsh-market/core'

export const name = 'dsh-market'

export const inject = ['webServer']

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

export function apply(ctx: {
  effect(fn: () => unknown, label?: string): unknown
  webServer: WebServer
  get(name: string): unknown
}): void {
  const cfg = resolveConfig()
  let cached: Awaited<ReturnType<typeof fetchMarketData>> | null = null

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

      case 'installed':
        return (await market()).plugins && scanInstalled(cfg, await market()).map((i) => ({
          ...i,
          plugin: i.plugin ? lite(i.plugin) : null,
        }))

      case 'profile:read':
        return readProfile(cfg)
      case 'profile:update': {
        const data = await market()
        const prev = readProfile(cfg)
        const profile = updateProfile(prev, data.plugins, {
          installed: args.installed as never,
          starredFullNames: args.starredFullNames as string[] | undefined,
          quizTags: args.quizTags as string[] | undefined,
        })
        writeProfile(cfg, profile)
        return profile
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

      case 'recommend': {
        const data = await market()
        const profile = readProfile(cfg) ?? updateProfile(null, data.plugins, {})
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
        return installPlugin(cfg, plugin, {
          dryRun: Boolean(args.dryRun),
          force: Boolean(args.force),
          targetProfile: (args.targetProfile as string) ?? readSettings(cfg).profile,
          runner: realRunner(),
        })
      }
      case 'uninstall': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
        return uninstallPlugin(cfg, plugin, {
          targetProfile: (args.targetProfile as string) ?? readSettings(cfg).profile,
          runner: realRunner(),
        })
      }

      // AI 代理安装：启动子代理执行安装（读 README → 确认配置 → 执行 → 验证）
      case 'ai:install': {
        const data = await market()
        const plugin = data.plugins.find((p) => p.id === args.pluginId)
        if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`)
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
        const prompt = buildInstallPrompt(plugin, readSettings(cfg).profile)
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
        return { started: true, childSessionId: run.sessionId ?? run.id ?? null }
      }

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

/** 生成 AI 安装任务的子代理提示词（Codex 式：读文档 → 确认 → 执行 → 验证） */
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
): string {
  const cmdLine =
    plugin.install.commands && plugin.install.commands.length > 0
      ? plugin.install.commands.join('\n    ')
      : '(无预解析命令，请阅读 README 确定)'
  return [
    `请安装 DSH 插件「${plugin.name}」（${plugin.fullName}）。`,
    ``,
    `【插件信息】`,
    `- 类型：${plugin.type === 'skill' ? 'skill（技能）' : 'cordis 插件'}（${plugin.type}）`,
    `- 简介：${plugin.descriptionZh ?? '(无中文简介)'}`,
    `- Stars：${plugin.stars}`,
    `- 需要配置：${plugin.install.needsConfig ? '是（API Key / Token 等）' : '否'}`,
    `- 参考安装命令（来自 README 解析，可能不精确）：`,
    `    ${cmdLine}`,
    ``,
    `【安装要求】`,
    `1. 先阅读仓库 README（https://github.com/${plugin.fullName}，可用 web_search 或抓取 raw README）确认真实安装方式，不要照搬上面可能过时的命令。`,
    `2. ${plugin.type === 'skill' ? `skill 型：按 README 指示安装到技能目录（通常 ~/.agents/skills，目录名建议 ${plugin.name} 或 ${plugin.name}-<版本>），常见方式是 git clone。` : `cordis 型：在目标 profile「${targetProfile}」执行 dsh plugin --profile ${targetProfile} add <真实包名或源>（npm 包名 / git 地址 / 本地目录均可）。`}`,
    `3. 需要配置（API Key/Token/环境变量）时，先向用户询问确认，不要猜测或伪造配置。`,
    `4. 安装前检查是否已装（skill 目录存在 / profile 依赖已含），已装则直接告知用户并停止。`,
    `5. 安装完成后做最小验证（目录/依赖存在；能读到 README 或 main 入口），然后简洁汇报：装了什么、装在哪里、是否需要重启 harness、需要什么配置。`,
    `6. 遇到问题（网络、权限、命令失败）先尝试修复或换用 README 的备用安装方式；确实无法完成时如实报告失败原因和已尝试的方案。`,
  ].join('\n')
}

/** 命令执行器：正式包运行在 harness 进程（无 shell 沙箱），可直接管道捕获 */
import { execFile } from 'node:child_process'

function realRunner() {
  return {
    run(command: string, opts: { cwd?: string; timeoutMs?: number }) {
      return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          process.env.ComSpec ?? 'cmd.exe',
          ['/d', '/s', '/c', command],
          { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120000, windowsHide: true },
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
