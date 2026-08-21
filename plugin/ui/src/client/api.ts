/**
 * Client → Host RPC 客户端（POST /market/api，Host 侧由 src/index.ts 提供）
 * 方法集与 core/src/cli.ts 保持一致。
 */

export interface LitePlugin {
  id: string
  type: 'skill' | 'cordis-plugin'
  name: string
  fullName: string
  descriptionZh: string | null
  tags: string[]
  stars: number
  pushedAt: string
  curated: boolean
  curatedReason?: string
  scoreTotal: number
  needsConfig: boolean
  installMethod: string
  installCommands: string[]
  installTarget?: string
}

export interface Recommendation {
  plugin: LitePlugin
  score: number
  relevance: number
  reasons: string[]
  origin: 'scene' | 'guess' | 'curated' | 'trending'
}

/** 整合包（lite，来自 core fetchPacksData） */
export interface LitePack {
  id: string
  name: string
  author: string
  descriptionZh: string | null
  tags: string[]
  stars: number
  pushedAt: string
  curated: boolean
  scoreTotal: number
  entryStats: { total: number; ok: number; failed: number; inMarket: number }
  entries: Array<{
    id: string
    type: 'skill' | 'cordis' | 'bundle' | 'pack'
    version: string
    resolved: { ok: boolean; inMarket: boolean; matchId?: string; reason?: string } | null
  }>
}

export interface InstalledItem {
  pluginId: string | null
  localName: string
  version: string | null
  source: 'skills' | 'profile' | 'other'
  plugin: LitePlugin | null
}

/** 已装插件更新检测结果（core/update.ts） */
export interface UpdateCheckResult {
  localName: string
  pluginId: string | null
  kind: 'npm' | 'github' | 'none'
  current: string | null
  latest: string | null
  hasUpdate: boolean
  error?: string
}

/** 装后四态生效验证（P0-1，core/verify.ts） */
export type ActivationState = 'live' | 'restart' | 'inert' | 'broken'

export interface ActivationStatus {
  state: ActivationState
  inBundles: boolean
  hasBundle: boolean
  hasClient: boolean
  reasons: string[]
  action?: string
}

/** 更新执行结果（P0-3，core/update.ts applyUpdate） */
export interface ApplyUpdateResult {
  applied: boolean
  before: string | null
  after: string | null
  noChange: boolean
  blocked?: 'minimum-release-age' | null
  reason?: string
  error?: string
  activation?: ActivationStatus
}

/** install 返回（含装后验证 + 构建脚本拦截信号） */
export interface InstallResultView {
  ok: boolean
  error?: string
  requiresRestart?: boolean
  activation?: ActivationStatus
  blockedBuilds?: string[]
}

/** 插件自身更新检测结果（core/update.ts checkSelfUpdate） */
export interface SelfUpdateInfo {
  current: string | null
  latest: string | null
  hasUpdate: boolean
  /** apply 执行结果 */
  applied?: boolean
  applyOutput?: string
}

export interface UserProfile {
  tags: Record<string, number>
  sources: { installed: string[]; starred: string[]; quiz: string[]; installedPluginIds: string[] }
  confidence: number
  modeOverride: 'auto' | 'novice' | 'veteran'
  updatedAt: string
}

export interface InstallStepView {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
}

export async function api<T = unknown>(method: string, args?: unknown): Promise<T> {
  const res = await fetch('/market/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args ?? {} }),
  })
  const data = (await res.json()) as { ok: boolean; result?: T; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'RPC failed')
  return data.result as T
}
