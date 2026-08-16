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
