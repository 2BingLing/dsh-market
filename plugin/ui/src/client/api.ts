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
  /**
   * N2 · 宿主兼容信息（Host 侧用本机 DSH 版本算好后下发）。
   * **只在插件声明了 DSH 版本要求时才有值**——未声明时该键直接不存在。
   * 客户端只渲染，不做任何版本判断（版本逻辑唯一实现在 core/compat.ts）。
   */
  dshCompat?: {
    status: 'ok' | 'incompatible' | 'unknown'
    /** 人话版要求，如 "DSH ≥ 0.1.5" */
    label: string
    required: string
    reason: string
    /** 是否应阻止安装（作者显式声明且不兼容） */
    block: boolean
    /** 是否为依赖推断来的软提示 */
    soft: boolean
    local: string | null
  }
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
  /** P6：失败分类（人话原因 + 建议动作 + 关键行） */
  classified?: FailureClassView
}

/** 插件自身更新检测结果（core/update.ts checkSelfUpdate） */
export interface SelfUpdateInfo {
  current: string | null
  latest: string | null
  hasUpdate: boolean
  /** apply 执行结果 */
  applied?: boolean
  applyOutput?: string
  /** P0：运行中不可就地自更新 → 需要用户停 harness 后手动执行 */
  needsManual?: boolean
  manualCommand?: string
  reason?: string
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

/** P6 错误分类（Host 侧 classifyFailure 的下发形状） */
export interface FailureClassView {
  code: string
  title: string
  hint: string
  keyLines: string[]
}

/** P6：RPC 错误附分类（人话原因 + 建议动作），不再是干巴巴的原始报错 */
export class RpcError extends Error {
  classified?: FailureClassView
  constructor(message: string, classified?: FailureClassView) {
    super(message)
    this.classified = classified
  }
}

export async function api<T = unknown>(method: string, args?: unknown): Promise<T> {
  const res = await fetch('/market/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args: args ?? {} }),
  })
  const data = (await res.json()) as { ok: boolean; result?: T; error?: string; classified?: FailureClassView }
  if (!data.ok) throw new RpcError(data.error ?? 'RPC failed', data.classified)
  return data.result as T
}
