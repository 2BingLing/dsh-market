/**
 * 插件市场面板（5-tab：推荐 / 搜索 / 收藏 / 已装 / 设置）
 * 数据全部来自 Host RPC（api.ts）。纯 React.createElement（无 JSX）。
 */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  api,
  type ActivationStatus,
  type ApplyUpdateResult,
  type InstalledItem,
  type LitePack,
  type LitePlugin,
  type Recommendation,
  type SelfUpdateInfo,
  type UpdateCheckResult,
  type UserProfile,
} from './api.ts'
import { getOpen, setOpen, subscribe } from './store.ts'
import { MarketLogo } from './logo.tsx'
import styles from './styles.module.css'

/** GitHub 设备流 client_id（dsh-market GitHub App，公开值非机密） */
const GH_CLIENT_ID = 'Iv23liYFieChYuBJklZp'
const GH_TOKEN_KEY = 'dsh-market:gh_token'
const GH_LOGIN_KEY = 'dsh-market:gh_login'
const GH_METHOD_KEY = 'dsh-market:gh_method'
const FAVORITES_KEY = 'dsh-market:favorites'

/** 收藏列表（localStorage） */
function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
function writeFavorites(list: string[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list))
}
function isFavorite(id: string): boolean {
  return readFavorites().includes(id)
}
function toggleFavorite(id: string): boolean {
  const list = readFavorites()
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
  writeFavorites(next)
  return next.includes(id)
}

/** 当前 GitHub token（浏览器 localStorage；设备流或 PAT） */
function ghToken(): string | null {
  return localStorage.getItem(GH_TOKEN_KEY)
}
/** 绑定方式：device（GitHub App，不能 star）/ pat */
function ghMethod(): 'device' | 'pat' | null {
  return (localStorage.getItem(GH_METHOD_KEY) as 'device' | 'pat' | null) ?? null
}

/** 跨 tab 搜索词（标签点击 → 搜索 tab） */
let searchSeed = ''
function setSearchSeed(t: string): void {
  searchSeed = t
}

/** 聚合热门中文标签（问卷/搜索快捷入口共用） */
function aggregateHotTags(plugins: LitePlugin[], n = 14): string[] {
  const counts = new Map<string, number>()
  for (const p of plugins) {
    for (const t of p.tags) {
      if (!/[\u4e00-\u9fff]/.test(t)) continue
      if (['效率工具', '开发辅助', 'AI 增强', 'AI增强'].includes(t)) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

// 问卷触发状态（模块级）：
// - "是否提交过问卷" 从持久化画像判断（profile.sources.quiz 非空）
// - 提交后：重新打开面板不再自动弹出，只有「切回新手模式」的动作才重新弹出
let quizTriggered = false
function markQuizSubmitted(): void {
  quizTriggered = false
}
function markQuizTriggered(): void {
  quizTriggered = true
}

// ---------- 通用小组件 ----------

function fmtStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function El(tag: string | ((props: any) => ReactNode), props: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return createElement(tag as never, props ?? {}, ...children)
}

/** P0-1 装后四态 → 中文短标签 */
function activationText(a: ActivationStatus | undefined): string {
  if (!a) return ''
  const map: Record<string, string> = {
    live: '已生效',
    restart: '重启后生效',
    inert: '未成为插件层',
    broken: '校验失败',
  }
  const label = map[a.state] ?? a.state
  return a.reasons && a.reasons.length ? `${label}（${a.reasons[0]}）` : label
}

/** P0-2 从安装/更新失败输出解析被拦构建包名 */
function parseBlockedFromOutput(output: string, item: InstalledItem): string[] {
  const raw = output.match(/Ignored build scripts\s*:\s*([^\n]*)/i)?.[1] ?? ''
  const pkgs = raw
    .split(',')
    .map((s) => s.trim().replace(/\.$/, '').replace(/@\d[\w.\-+]*$/, ''))
    .filter(Boolean)
  // 解析不到时退回插件包名（集合仍受 build 白名单校验约束）
  if (pkgs.length === 0 && item.plugin) {
    const fallback = item.plugin.name.replace(/\.$/, '').trim()
    if (fallback) pkgs.push(fallback)
  }
  return [...new Set(pkgs)]
}

// ---------- Toast（B 稿底部黑底白字，DOM 直挂不受 React 树影响） ----------

let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(msg: string, duration = 2200): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll('[data-dshm-toast]').forEach((n) => n.remove())
  if (toastTimer) clearTimeout(toastTimer)
  const el = document.createElement('div')
  el.setAttribute('data-dshm-toast', '')
  el.className = styles.toast
  el.textContent = msg
  document.body.appendChild(el)
  toastTimer = setTimeout(() => el.remove(), duration)
}

// ---------- 线性 SVG 图标（B 方向：1.5px 描边，与 DSH 语言一致，禁 emoji） ----------

/** 通用线性图标：dangerouslySetInnerHTML 承载 path/circle 内容 */
function Icon(props: { d: string; size?: number; className?: string }): ReactNode {
  return El('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: props.size ?? 14,
    height: props.size ?? 14,
    className: props.className,
    dangerouslySetInnerHTML: { __html: props.d },
  })
}

/** 图标 path 集（与 design-ref/ui-redesign/direction-B-克制增强.html 一致） */
const ICON_SCENE = '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>'
const ICON_HEART = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>'
const ICON_AWARD = '<path d="M6 3h12l3 6-9 12L3 9l3-6z"/><path d="M3 9h18M9 21l3-3 3 3"/>'
const ICON_CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
const ICON_LINK = '<path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6v6"/><path d="M10 14 20 4"/>'
const ICON_STAR = '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>'
const ICON_STAR_OUTLINE = '<path d="M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.3L6.7 19l1.4-6-4.6-4 6.1-.5z"/>'
const ICON_CLOSE = '<path d="M18 6 6 18M6 6l12 12"/>'
const ICON_CHECK = '<path d="M20 6 9 17l-5-5"/>'
const ICON_WARN = '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>'
const ICON_EXTERNAL = '<path d="M7 17 17 7M7 7h10v10"/>'
const ICON_HELP = '<circle cx="12" cy="12" r="9"/><path d="M9 10a3 3 0 0 1 6 0c0 2-3 2.5-3 4"/><path d="M12 17h.01"/>'
const ICON_MODE = '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M12 12 21 3"/>'
const ICON_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'
const ICON_GITHUB = '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-5.7 0-1.3-.5-2.4-1.3-3.2.1-.3.6-1.6-.1-3.3 0 0-1-.3-3.4 1.2a11.6 11.6 0 0 0-6.2 0C6.5 2.5 5.5 2.8 5.5 2.8 4.8 4.5 5.3 5.8 5.4 6.1 4.6 6.9 4.1 8 4.1 9.3c0 4.3 2.7 5.4 5.5 5.7-.6.6-.6 1.2-.5 2V21"/><path d="M9 9v4M9 9H7.5M9 20h3"/>'
const ICON_PACKAGE = '<path d="M22 7.5 12 2 2 7.5v9L12 22l10-5.5v-9z"/><path d="M2 7.5 12 13l10-5.5M12 22v-9"/>'

// ---------- 插件卡片 ----------

function PluginCard(props: {
  plugin: LitePlugin
  reasons?: string[]
  origin?: string
  onInstall: (p: LitePlugin) => void
  onTagClick: (t: string) => void
}): ReactNode {
  const { plugin, reasons, onInstall, onTagClick } = props
  const tags = (plugin.tags ?? []).filter((t) => /[\u4e00-\u9fff]/.test(t)).slice(0, 4)
  const [fav, setFav] = useState(() => isFavorite(plugin.id))
  const [starring, setStarring] = useState(false)
  const [starErr, setStarErr] = useState('')

  const toggleFav = () => {
    const now = toggleFavorite(plugin.id)
    setFav(now)
    toast(now ? `已收藏「${plugin.name}」` : `已取消收藏「${plugin.name}」`)
  }

  // 加星（仅 GitHub 绑定后；GitHub App 设备流 token 不支持 star，PAT 可以）
  const toggleStar = async () => {
    const token = ghToken()
    if (!token) {
      toast('未绑定 GitHub，请到「设置」绑定后可加星')
      return
    }
    if (ghMethod() === 'device') {
      setStarErr('设备流授权不支持加星，请在设置里改用 PAT（个人令牌）绑定')
      return
    }
    setStarring(true)
    setStarErr('')
    try {
      const [owner, repo] = plugin.fullName.split('/')
      await api('gh:star', { token, owner, repo, action: 'star' })
      setStarErr('')
      toast(`已加星「${plugin.name}」`)
    } catch (e) {
      setStarErr((e as Error).message.includes('403') || (e as Error).message.includes('404')
        ? '当前授权方式不支持加星，请改用 PAT（个人令牌）绑定'
        : `加星失败：${(e as Error).message}`)
    } finally {
      setStarring(false)
    }
  }

  return El('div', { className: styles.card, 'data-type': plugin.type },
    El('div', { className: styles.cardHead },
      El('span', { className: styles.cardName, title: plugin.fullName }, plugin.name),
      El('span', { className: styles.cardBadge }, plugin.type === 'skill' ? '技能' : '插件'),
      El('span', { className: styles.cardStars },
        El(Icon, { d: ICON_STAR, size: 13 }),
        fmtStars(plugin.stars),
      ),
    ),
    plugin.descriptionZh
      ? El('div', { className: styles.cardDesc }, plugin.descriptionZh)
      : null,
    El('div', { className: styles.cardTags },
      ...tags.map((t) =>
        El('span', { key: t, className: styles.tag, onClick: () => onTagClick(t) }, t),
      ),
      reasons && reasons.length > 0
        ? reasons.map((r, i) =>
            El('span', {
              key: `r${i}`,
              className: r.startsWith('AI：') ? styles.reasonAi : styles.reason,
            }, r),
          )
        : null,
    ),
    El('div', { className: styles.cardActions },
      El('button',
        {
          className: styles.repoBtn,
          title: `打开 GitHub 仓库：${plugin.fullName}`,
          onClick: () => window.open(`https://github.com/${plugin.fullName}`, '_blank', 'noopener noreferrer'),
        },
        El(Icon, { d: ICON_LINK, size: 13 }),
        '仓库',
      ),
      El('span', { className: styles.spacer }),
      El('button',
        {
          className: `${styles.favBtn} ${fav ? styles.favBtnOn : ''}`,
          title: fav ? '取消收藏' : '收藏（稍后安装）',
          onClick: toggleFav,
        },
        El(Icon, { d: fav ? ICON_STAR : ICON_STAR_OUTLINE, size: 12 }),
        '收藏',
      ),
      El('button',
        {
          className: `${styles.iconBtn} ${starring ? styles.iconBtnOn : ''}`,
          title: ghToken() ? '在 GitHub 加星这个仓库（PAT 绑定支持）' : '未绑定 GitHub，点击查看绑定方式',
          disabled: starring,
          onClick: () => void toggleStar(),
        },
        starring
          ? '…'
          : El(Icon, { d: ICON_STAR, size: 15 }),
      ),
      El('button', { className: `${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`, onClick: () => onInstall(plugin) }, '安装'),
    ),
    starErr ? El('div', { className: styles.cardActionHint }, starErr) : null,
  )
}

// ---------- 安装流程 ----------

function InstallModal(props: {
  plugin: LitePlugin
  onDone: () => void
  onClose: () => void
}): ReactNode {
  const { plugin, onDone, onClose } = props
  const [phase, setPhase] = useState<'confirm' | 'running' | 'handedOff' | 'error'>('confirm')
  const [error, setError] = useState('')
  const [childSessionId, setChildSessionId] = useState<string | null>(null)
  // T0 直装结果（零 LLM 完成时无子会话）
  const [t0, setT0] = useState<{
    mode?: string
    ok?: boolean
    alreadyInstalled?: boolean
    smokeFailed?: boolean
    error?: string | null
  } | null>(null)

  // AI 代理安装（路由式）：T0 直装（零 LLM：已装/配方/解析命令）→ 需要时才交给协议子代理
  const startAi = async () => {
    setPhase('running')
    try {
      const r = await api<{
        started: boolean
        childSessionId: string | null
        mode?: string
        ok?: boolean
        alreadyInstalled?: boolean
        smokeFailed?: boolean
        error?: string | null
      }>('ai:install', {
        pluginId: plugin.id,
      })
      setChildSessionId(r.childSessionId)
      if (!r.started) setT0(r)
      setPhase('handedOff')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const cmd =
    plugin.installCommands && plugin.installCommands.length > 0
      ? plugin.installCommands[0]
      : plugin.installMethod === 'skills-add'
        ? `git clone https://github.com/${plugin.fullName}.git`
        : `dsh plugin --profile web add ${plugin.name}`

  return El('div', { className: styles.modalBackdrop, onClick: onClose },
    El('div', { className: styles.modal, onClick: (e: MouseEvent) => e.stopPropagation() },
      // 步骤条（B：确认 → 运行中 → 完成）
      El('div', { className: styles.steps },
        El('div', { className: `${styles.step} ${styles.stepActive}` },
          El('span', { className: styles.stepDot }, '1'),
          '确认',
          El('span', { className: phase === 'confirm' ? styles.stepBar : `${styles.stepBar} ${styles.stepBarDone}` }),
        ),
        El('div', { className: phase === 'confirm' ? styles.step : `${styles.step} ${phase === 'handedOff' ? styles.stepDone : styles.stepActive}` },
          El('span', { className: styles.stepDot }, phase === 'handedOff' ? El(Icon, { d: ICON_CHECK, size: 11 }) : '2'),
          '运行中',
          El('span', { className: phase === 'handedOff' ? `${styles.stepBar} ${styles.stepBarDone}` : styles.stepBar }),
        ),
        El('div', { className: phase === 'handedOff' ? `${styles.step} ${styles.stepDone}` : styles.step },
          El('span', { className: styles.stepDot }, phase === 'handedOff' ? El(Icon, { d: ICON_CHECK, size: 11 }) : '3'),
          '完成',
        ),
      ),
      phase === 'confirm'
        ? El('div', null,
            El('div', { className: styles.modalTitle }, `确认安装「${plugin.name}」`),
            El('div', { className: styles.modalDesc },
              `将先尝试零 LLM 直装（配方缓存 / README 解析命令 + 冒烟验证）；需要时才交给话题子代理。需要配置（API Key / Token）时会先向你确认。`,
            ),
            plugin.needsConfig
              ? El('p', { className: styles.warn },
                  El(Icon, { d: ICON_WARN, size: 13, className: styles.inlineIcon }),
                  '该插件需要额外配置（API Key / Token），AI 会向你询问。')
              : null,
            El('p', { className: styles.ghTip },
              plugin.type === 'skill'
                ? '目标：装到技能目录（~/.agents/skills），装完即可用。'
                : '目标：装进 web profile，装完需重启 harness 生效。'),
            El('details', { className: styles.advanced },
              El('summary', null, '高级：查看/复制手动命令'),
              El('code', { className: styles.advancedCmd }, cmd),
              El('p', { className: styles.advancedTip },
                '提示：手动命令仅供参考，不一定正确，请以该项目 README 为准。'),
            ),
            El('div', { className: styles.modalActions },
              El('button', { className: styles.btn, onClick: onClose }, '取消'),
              El('button', { className: `${styles.btn} ${styles.btnPrimary}`, onClick: () => void startAi() }, '确认安装'),
            ),
          )
        : phase === 'running'
          ? El('div', null,
              El('div', { className: styles.modalTitle }, '正在安装'),
              El('div', { className: styles.loading }, '正在唤起 AI 助手…'),
            )
          : phase === 'handedOff'
            ? El('div', { className: styles.modalSuccess },
                El('div', { className: styles.modalSuccessIcon }, El(Icon, { d: ICON_CHECK, size: 22 })),
                El('div', { className: styles.modalSuccessTitle },
                  childSessionId ? '已交给 AI 助手安装' : '安装完成（零 Token 直装）'),
                El('p', { className: styles.modalDesc },
                  childSessionId
                    ? `AI 助手已开始工作（子会话 ${childSessionId.slice(0, 8)}…），请到会话中查看进度；需要配置时 AI 会向你确认。`
                    : t0?.alreadyInstalled
                      ? `「${plugin.name}」已在目标位置检测到安装，已跳过。`
                      : t0?.ok && !t0.smokeFailed
                        ? `已通过${t0.mode === 'recipe' ? '配方' : '解析命令'}直装完成，冒烟验证通过，无需 AI 介入。`
                        : `直装未通过验证（${t0?.error ?? '冒烟失败'}），已转交 AI 助手处理。`,
                ),
                El('div', { className: styles.modalActions },
                  El('button', { className: `${styles.btn} ${styles.btnPrimary}`, onClick: () => { onDone(); onClose() } }, '知道了'),
                ),
              )
            : El('div', null,
                El('div', { className: styles.modalError },
                  El(Icon, { d: ICON_CLOSE, size: 14, className: styles.inlineIcon }),
                  `启动失败：${error}`),
                El('div', { className: styles.modalActions },
                  El('button', { className: styles.btn, onClick: () => setPhase('confirm') }, '重试'),
                  El('button', { className: `${styles.btn} ${styles.btnPrimary}`, onClick: onClose }, '关闭'),
                ),
              ),
    ),
  )
}

// ---------- 场景推荐行（含收藏按钮） ----------

function SceneRow(props: {
  plugin: LitePlugin
  onInstall: (p: LitePlugin) => void
}): ReactNode {
  const { plugin, onInstall } = props
  const [fav, setFav] = useState(() => isFavorite(plugin.id))
  const toggleFav = () => {
    const now = toggleFavorite(plugin.id)
    setFav(now)
    toast(now ? `已收藏「${plugin.name}」` : `已取消收藏「${plugin.name}」`)
  }
  return El('div', { className: styles.sceneRow },
    El('div', { className: styles.sceneInfo },
      El('div', { className: styles.sceneName }, plugin.name),
      El('div', { className: styles.sceneDesc }, plugin.descriptionZh),
    ),
    El('button',
      {
        className: `${styles.favBtn} ${fav ? styles.favBtnOn : ''}`,
        title: fav ? '取消收藏' : '收藏（稍后安装）',
        onClick: toggleFav,
      },
      El(Icon, { d: fav ? ICON_STAR : ICON_STAR_OUTLINE, size: 12 }),
      '收藏',
    ),
    El('button', { className: `${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`, onClick: () => onInstall(plugin) }, '获取'),
  )
}

// ---------- 推荐 Tab ----------

function RecommendTab(props: {
  plugins: LitePlugin[]
  profile: UserProfile | null
  recs: Recommendation[]
  loading: boolean
  installedIds: Set<string>
  onInstall: (p: LitePlugin) => void
  onTagClick: (t: string) => void
  onSwitchMode: () => Promise<void>
  onQuizSubmit: (tags: string[]) => Promise<void>
  sceneState: { loading: boolean; recs: Recommendation[]; sceneTags: string[] }
  onFetchScene: () => Promise<void>
}): ReactNode {
  const { plugins, profile, recs, loading, installedIds, onInstall, onTagClick, onSwitchMode, onQuizSubmit, sceneState, onFetchScene } = props
  const [quizOpen, setQuizOpen] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  // 有数据时不显示 loading 占位（避免模式切换/刷新时整页闪烁）
  if (loading && recs.length === 0) return El('div', { className: styles.stateHint }, '加载推荐中…')
  if (recs.length === 0 && !loading) return El('div', { className: styles.stateHint }, '暂无推荐，先去搜索或完成问卷吧')

  const isNovice = !profile || profile.modeOverride === 'novice' || (profile.modeOverride === 'auto' && profile.confidence < 0.4)
  const groups: Array<{ title: string; icon: string; items: Recommendation[] }> = [
    { title: '猜你喜欢', icon: ICON_HEART, items: recs.filter((r) => r.origin === 'guess') },
    { title: '精选', icon: ICON_AWARD, items: recs.filter((r) => r.origin === 'curated') },
    { title: '最近更新', icon: ICON_CLOCK, items: recs.filter((r) => r.origin === 'trending') },
  ].filter((g) => g.items.length > 0)

  const quizTags = aggregateHotTags(plugins, 20)
  const togglePick = (t: string) => {
    setPicked((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.length >= 6 ? prev : [...prev, t]))
  }
  const submitQuiz = () => {
    if (picked.length === 0) return
    void onQuizSubmit(picked).then(() => {
      markQuizSubmitted()
      setQuizOpen(false)
      toast('已根据偏好重新生成推荐')
    })
  }
  const skipQuiz = () => {
    setQuizOpen(false)
    toast('已跳过，推荐将按默认偏好生成')
  }
  // 问卷显示条件（"是否提交过"从持久化画像判断，刷新后依然有效）：
  // - 提交过问卷（profile.sources.quiz 非空）→ 只有「切回新手」的动作才重新弹出
  // - 未提交过 → 新手模式下自动显示（冷启动引导）
  const quizSubmitted = !profile || profile.sources.quiz.length > 0
  const showQuiz = isNovice && quizOpen && (quizSubmitted ? quizTriggered : true)

  return El('div', { className: styles.tabBody },
    showQuiz
      ? El('div', { className: styles.quizCard },
          El('div', { className: styles.quizHead },
            El('span', { className: styles.quizHeadIcon }, El(Icon, { d: ICON_HELP, size: 16 })),
            El('span', { className: styles.quizTitle }, '先了解你的偏好'),
            El('button', { className: `${styles.btn} ${styles.btnGhost} ${styles.btnSm}`, onClick: skipQuiz }, '跳过'),
          ),
          El('div', { className: styles.quizDesc }, '告诉我你想用插件做什么，给我更准的推荐（可多选，可跳过）。'),
          El('div', { className: styles.quizTags },
            ...quizTags.map((t) =>
              El('span', {
                key: t,
                className: `${styles.quizChip} ${picked.includes(t) ? styles.quizChipOn : ''}`,
                onClick: () => togglePick(t),
              }, t),
            ),
          ),
          El('div', { className: styles.quizActions },
            El('span', { className: styles.quizCount }, `已选 ${picked.length} / 6`),
            El('div', { className: styles.quizCta },
              El('button', {
                className: `${styles.btn} ${styles.btnPrimary}`,
                disabled: picked.length === 0,
                onClick: submitQuiz,
              }, '为我推荐'),
            ),
          ),
        )
      : null,
    El('div', { className: styles.recommendToolbar },
      El('span', { className: styles.recommendToolbarIcon }, El(Icon, { d: ICON_MODE, size: 14 })),
      El('span', { className: styles.recommendHint },
        isNovice
          ? ['当前为', El('b', { key: 'b1' }, '新手模式'), '，推荐更稳妥通用。可切换到', El('b', { key: 'b2' }, '个性化模式'), '获取贴合你工作流的建议。']
          : ['当前为', El('b', { key: 'b1' }, '个性化模式'), '，推荐将贴合你的工作流与偏好持续调整。'],
      ),
    ),
    El('div', { className: styles.modeSwitchRow },
      El('button',
        {
          className: `${styles.btn} ${styles.btnSm}`,
          onClick: () => void onSwitchMode(),
        },
        isNovice ? '切换到 · 个性化模式' : '切换到 · 新手模式',
      ),
    ),
    // 场景推荐（手动触发：读当前会话上下文；B 稿行式卡片）
    El('div', { className: styles.section },
      El('div', { className: styles.sectionHead },
        El(Icon, { d: ICON_SCENE, size: 14, className: styles.sectionIcon }),
        El('h3', { className: styles.sectionTitle }, '适合当前场景'),
        El('span', { className: styles.sectionNote },
          sceneState.loading
            ? '读取会话上下文…'
            : sceneState.recs.length > 0
              ? `基于「${sceneState.sceneTags.slice(0, 3).join(' / ')}」`
              : '基于你的工作区',
        ),
        sceneState.loading
          ? null
          : El('button', { className: `${styles.btn} ${styles.btnSm}`, onClick: () => void onFetchScene() },
              sceneState.recs.length > 0 ? '刷新' : '获取场景推荐',
            ),
      ),
      sceneState.loading
        ? El('div', { className: styles.stateHint }, '读取中…')
        : sceneState.recs.length > 0
          ? El('div', { className: styles.sceneList },
              ...sceneState.recs.slice(0, 4).map((r) =>
                El(SceneRow, {
                  key: r.plugin.id,
                  plugin: r.plugin,
                  onInstall,
                }),
              ),
            )
          : El('p', { className: styles.sceneEmpty }, '根据你当前正在做的事推荐插件（点击获取，基于会话内容）'),
    ),
    ...groups.map((g) =>
      El('div', { key: g.title, className: styles.section },
        El('div', { className: styles.sectionHead },
          El(Icon, { d: g.icon, size: 14, className: styles.sectionIcon }),
          El('h3', { className: styles.sectionTitle }, g.title),
          g.title === '精选' ? El('span', { className: styles.sectionNote }, '编辑推荐') : null,
        ),
        El('div', { className: styles.grid2 },
          ...g.items.map((r) =>
            El(PluginCard, {
              key: r.plugin.id,
              plugin: r.plugin,
              reasons: r.reasons,
              origin: r.origin,
              onInstall,
              onTagClick,
            }),
          ),
        ),
      ),
    ),
    installedIds.size > 0
      ? El('div', { className: styles.installedNote }, `已排除 ${installedIds.size} 个已安装插件`)
      : null,
  )
}

// ---------- 搜索 Tab ----------

function SearchTab(props: {
  plugins: LitePlugin[]
  onInstall: (p: LitePlugin) => void
  onTagClick: (t: string) => void
}): ReactNode {
  const { plugins, onInstall, onTagClick } = props
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [type, setType] = useState<string>('all')
  const [results, setResults] = useState<Array<{ plugin: LitePlugin; relevance: number; tagHits: number; aiReason?: string }>>([])
  const [searching, setSearching] = useState(false)
  const [semanticOn, setSemanticOn] = useState(false) // 语义搜索默认关闭（省 token）
  const [semanticNotice, setSemanticNotice] = useState('')
  const [semanticTags, setSemanticTags] = useState<string[]>([])
  const [hotExpanded, setHotExpanded] = useState(false)
  const [visible, setVisible] = useState(50)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 从标签点击带入的初始查询
  useEffect(() => {
    if (searchSeed) {
      setQuery(searchSeed)
      setSearchSeed('')
    }
  }, [])

  const hotAll = useMemo(() => aggregateHotTags(plugins, 40), [plugins])
  const hot = hotExpanded ? hotAll : hotAll.slice(0, 8)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch()
    }, semanticOn && query.trim().length >= 2 ? 700 : 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, tags, type, semanticOn])

  const runSearch = async () => {
    setSearching(true)
    setVisible(50)
    try {
      // 语义搜索：LLM 翻译意图 → 标签增强召回（harness 独有能力）
      if (semanticOn && query.trim().length >= 2) {
        const r = await api<{
          tags: string[]
          results: Array<{ plugin: LitePlugin; relevance: number; tagHits: number }>
        }>('search:semantic', { query })
        setSemanticTags(r.tags)
        if (r.results.length > 0) {
          setResults(r.results)
          return
        }
        // 语义无结果 → 降级普通搜索
      }
      setSemanticTags([])
      const opts: Record<string, unknown> = { limit: 0 } // 0 = 全量（市场收录 500+）
      if (tags.length) opts.tags = tags
      if (type !== 'all') opts.type = type
      const r = await api<Array<{ plugin: LitePlugin; relevance: number; tagHits: number }>>('search', {
        query,
        options: opts,
      })
      setResults(r)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const toggleTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  return El('div', { className: styles.tabBody },
    // 搜索输入（B：放大镜 + 输入框 + 清除按钮）
    El('div', { className: styles.searchWrap },
      El('span', { className: styles.searchWrapIcon }, El(Icon, { d: ICON_SEARCH, size: 15 })),
      El('input', {
        className: styles.searchInput,
        placeholder: '搜索插件名称、标签或描述…',
        value: query,
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
      query.length > 0
        ? El('button', { className: styles.searchClear, 'aria-label': '清除', onClick: () => setQuery('') },
            El(Icon, { d: ICON_CLOSE, size: 13 }))
        : null,
    ),
    // 类型筛选（B：filter chips）
    El('div', { className: styles.filterRow },
      ...([
        ['all', '全部'],
        ['cordis-plugin', 'cordis 插件'],
        ['skill', 'skill'],
      ] as const).map(([v, label]) =>
        El('span', {
          key: v,
          className: `${styles.filterChip} ${type === v ? styles.filterChipOn : ''}`,
          onClick: () => setType(v),
        }, label),
      ),
    ),
    // AI 语义搜索（B：开关卡片，待开发态）
    El('div', { className: styles.semanticToggle },
      El('div', { className: styles.semanticInfo },
        El('div', { className: styles.semanticTitle },
          'AI 语义搜索',
          El('span', { className: styles.semanticPill }, '待开发'),
        ),
        El('div', { className: styles.semanticDesc }, '用自然语言理解意图，帮你找到「最贴近需求」的插件。'),
      ),
      El('div', { className: styles.semanticSwitch, title: '功能待开发，暂不可用' }),
    ),
    // 热门标签（B：白底胶囊 chips）
    El('div', { className: styles.hotTagsTitle }, '热门标签'),
    El('div', { className: styles.tagCloud },
      ...hot.map((t) =>
        El('span', {
          key: t,
          className: `${styles.hotTag} ${tags.includes(t) ? styles.hotTagOn : ''}`,
          onClick: () => toggleTag(t),
        }, t),
      ),
    ),
    hotAll.length > 8
      ? El('div', { className: styles.tagMoreRow },
          El('button', {
            className: `${styles.btn} ${styles.btnGhost} ${styles.btnSm}`,
            onClick: () => setHotExpanded((v) => !v),
          }, hotExpanded ? '收起标签' : '展开全部标签'),
        )
      : null,
    semanticNotice
      ? El('p', { className: styles.sceneEmpty }, semanticNotice)
      : null,
    semanticTags.length > 0
      ? El('div', { className: styles.semanticResult },
          `AI 理解为你想要：`,
          ...semanticTags.map((t) =>
            El('span', {
              key: t,
              className: `${styles.hotTag} ${tags.includes(t) ? styles.hotTagOn : ''}`,
              onClick: () => toggleTag(t),
            }, t),
          ),
        )
      : null,
    searching && results.length === 0
      ? El('div', { className: styles.stateHint }, '搜索中…')
      : results.length === 0 && query === '' && tags.length === 0
        ? El('div', { className: styles.stateHint }, '输入关键词或选择标签开始搜索')
        : results.length === 0
          ? El('div', { className: styles.emptyState },
              El('div', { className: styles.emptyIcon }, El(Icon, { d: ICON_SEARCH, size: 44 })),
              El('div', { className: styles.emptyTitle }, '没有找到匹配的插件'),
              El('div', { className: styles.emptyDesc }, '换个关键词或标签试试。'),
            )
          : El('div', null,
              El('div', { className: styles.resultCount }, '共 ', El('b', null, String(results.length)), ' 个结果'),
              El('div', { className: styles.results },
                ...results.slice(0, visible).map((r) =>
                  El(PluginCard, {
                    key: r.plugin.id,
                    plugin: r.plugin,
                    reasons: r.aiReason
                      ? [`AI：${r.aiReason}`]
                      : r.tagHits > 0
                        ? [`标签命中 ${r.tagHits} 项`]
                        : undefined,
                    onInstall,
                    onTagClick,
                  }),
                ),
              ),
              visible < results.length
                ? El('div', { className: styles.loadMoreRow },
                    El('button', {
                      className: styles.loadMore,
                      onClick: () => setVisible((v) => v + 50),
                    }, `加载更多（还有 ${results.length - visible} 个）`),
                  )
                : null,
            ),
  )
}

// ---------- 已装 Tab ----------

function InstalledTab(props: {
  installed: InstalledItem[]
  loading: boolean
  onChanged: () => void
}): ReactNode {
  const { installed, loading, onChanged } = props
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 其他已装（未收录）默认只显示前 5 个，点「查看详细」展开全部
  const [showAllUnmatched, setShowAllUnmatched] = useState(false)
  // 更新检测：localName → 检测结果（手动触发，结果 1h 内复用，force 时重新查询）
  const [updateMap, setUpdateMap] = useState<Record<string, UpdateCheckResult>>({})
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  // P0-1/P0-2/P0-3：装后四态验证结果（localName → status）· 验证中 · 构建脚本放行中
  const [verifMap, setVerifMap] = useState<Record<string, ActivationStatus>>({})
  const [verifying, setVerifying] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  const uninstall = async (item: InstalledItem) => {
    if (!item.pluginId) return
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; error?: string }>('uninstall', { pluginId: item.pluginId })
      if (!r.ok) {
        toast(`卸载失败：${r.error ?? '未知错误'}`, 3500)
        return
      }
      onChanged()
      toast(item.source === 'profile' ? '卸载完成，重启 harness 后生效' : '卸载完成')
    } catch (e) {
      toast(`卸载失败：${(e as Error).message}`, 3500)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  /** 检查更新（force：绕过 core 内存缓存，重新查 npm / GitHub） */
  const checkNow = async () => {
    setChecking(true)
    setCheckError('')
    try {
      const list = await api<UpdateCheckResult[]>('update:check', { force: true })
      const m: Record<string, UpdateCheckResult> = {}
      for (const r of list) m[r.localName] = r
      setUpdateMap(m)
    } catch (e) {
      setCheckError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  /** P0-1 装后四态验证：对单个已装项手动触发（读 profile 真值） */
  const verifyOne = async (item: InstalledItem) => {
    if (!item.pluginId || verifying) return
    setVerifying(item.localName)
    try {
      const a = await api<ActivationStatus>('verify', { pluginId: item.pluginId })
      setVerifMap((m) => ({ ...m, [item.localName]: a }))
      toast(`「${item.localName}」：${activationText(a)}`, 3200)
    } catch (e) {
      toast(`验证失败：${(e as Error).message}`, 3000)
    } finally {
      setVerifying(null)
    }
  }

  /**
   * P0-3 更新执行（update:apply）：before/after 对比，假更新防误报；
   * P0-2 构建脚本被拦 → 自动放行并重试一次；P0-1 更新成功后展示装后四态。
   */
  const updatePlugin = async (item: InstalledItem) => {
    if (!item.pluginId || updating) return
    setUpdating(item.localName)
    try {
      let r = await api<ApplyUpdateResult>('update:apply', { pluginId: item.pluginId })

      // P0-2：构建脚本被拦 → 解析被拦包名 → 放行 → 自动重试一次
      if (r.error && !r.applied && /Ignored build scripts|approve-builds/i.test(r.error)) {
        const blocked = parseBlockedFromOutput(r.error, item)
        setApproving(item.localName)
        const ar = await api<{ ok: boolean; error?: string }>('builds:approve', { packages: blocked })
        if (!ar.ok) {
          setApproving(null)
          toast(`构建脚本放行失败：${ar.error ?? '未知错误'}`, 3500)
          return
        }
        toast(`已放行构建脚本（${blocked.join('、')}），自动重试…`, 3200)
        r = await api<ApplyUpdateResult>('update:apply', { pluginId: item.pluginId })
        setApproving(null)
      }

      if (r.error && !r.applied) {
        toast(`更新失败：${r.error}`, 4500)
        return
      }

      // P0-3：假更新防误报——被发布年龄门槛挡住，提供「放宽门槛并重试」
      if (r.blocked === 'minimum-release-age') {
        const msg = r.reason ?? '新版本已发布但被 pnpm 发布年龄门槛（minimumReleaseAge）挡住'
        if (typeof window !== 'undefined' && window.confirm(`${msg}。\n\n点击「确定」= 放宽门槛（minimumReleaseAge: 0）并自动重试；「取消」= 等门槛期过后再更。`)) {
          const rel = await api<{ ok: boolean; error?: string }>('update:relax', {})
          if (!rel.ok) {
            toast(`放宽门槛失败：${rel.error ?? '未知错误'}`, 3500)
            return
          }
          toast('已放宽发布年龄门槛，自动重试…', 3200)
          r = await api<ApplyUpdateResult>('update:apply', { pluginId: item.pluginId })
          if (r.error && !r.applied) {
            toast(`更新失败：${r.error}`, 4500)
            return
          }
        } else {
          toast('已取消；新版本将在发布年龄门槛期过后自动可更新', 3500)
          return
        }
      }

      if (r.noChange && !r.applied) {
        toast(r.reason ?? '版本无变化', 3000)
        return
      }

      onChanged() // 重扫已装（版本/目录变化）
      setUpdateMap((m) => {
        const next = { ...m }
        delete next[item.localName] // 清掉旧结果，避免显示过期版本
        return next
      })
      const act = r.activation
      const verTxt = act ? ` · ${activationText(act)}` : ''
      toast(`更新完成${verTxt}`, 3500)
      if (act) setVerifMap((m) => ({ ...m, [item.localName]: act }))
    } catch (e) {
      toast(`更新失败：${(e as Error).message}`, 3500)
    } finally {
      setUpdating(null)
    }
  }

  /** 单行检测状态（未检测过返回 null） */
  const renderCheck = (item: InstalledItem): ReactNode => {
    const r = updateMap[item.localName]
    if (!r) return null
    if (r.kind === 'none') {
      return El('div', { className: styles.updateHint }, `无法检测 · ${r.error ?? ''}`)
    }
    if (r.hasUpdate) {
      return El('div', { className: styles.updateChip },
        r.kind === 'npm' ? `可更新 ${r.current} → ${r.latest}` : '远端有新提交')
    }
    return El('div', { className: styles.latestChip },
      r.kind === 'npm' ? `已是最新 ${r.latest}` : '已是最新')
  }

  if (loading) return El('div', { className: styles.stateHint }, '扫描已装插件…')
  const matched = installed.filter((i) => i.pluginId)
  const unmatched = installed.filter((i) => !i.pluginId)

  return El('div', { className: styles.tabBody },
    El('div', { className: styles.section },
      El('div', { className: styles.sectionHead },
        El(Icon, { d: ICON_PACKAGE, size: 14, className: styles.sectionIcon }),
        El('h3', { className: styles.sectionTitle }, '已安装'),
        El('span', { className: styles.sectionNote }, `${installed.length} 个`),
        installed.length > 0
          ? El('button', {
              className: `${styles.btn} ${styles.btnSm} ${styles.btnGhost}`,
              disabled: checking,
              onClick: () => void checkNow(),
            }, checking ? '检测中…' : '检查更新')
          : null,
      ),
      checkError ? El('div', { className: styles.updateHint }, `检测失败：${checkError}`) : null,
      matched.length === 0 ? El('div', { className: styles.stateHint }, '未检测到市场收录的已装插件') : null,
      ...matched.map((i, idx) =>
        El('div', { key: `${i.localName}-${idx}`, className: styles.installedRow },
          El('div', { className: styles.installedInfo },
            El('div', { className: styles.installedHead },
              El('span', { className: styles.installedName }, i.plugin?.name ?? i.localName),
              El('span', { className: styles.cardBadge }, i.source === 'skills' ? '技能' : '插件'),
            ),
            El('div', { className: styles.installedMeta },
              `${i.version ?? '未知版本'} · ${i.source === 'skills' ? 'skill' : 'profile'}`,
            ),
            // P0-1 装后四态：已有验证结果则展示状态短标签
            verifMap[i.localName]
              ? El('div', {
                  className: `${styles.activationChip} ${verifMap[i.localName].state === 'live' ? styles.activationLive : verifMap[i.localName].state === 'broken' ? styles.activationBroken : verifMap[i.localName].state === 'inert' ? styles.activationInert : ''}`,
                }, activationText(verifMap[i.localName]))
              : null,
            checking ? El('div', { className: styles.updateHint }, '检测中…') : renderCheck(i),
          ),
          confirming === i.localName
            ? El('div', { className: styles.installedActions },
                El('button', { className: `${styles.btn} ${styles.btnSm}`, onClick: () => setConfirming(null) }, '取消'),
                El('button', {
                  className: `${styles.btn} ${styles.btnSm} ${styles.btnDanger}`,
                  disabled: busy,
                  onClick: () => void uninstall(i),
                }, '确认卸载'),
              )
            : El('div', { className: styles.installedActions },
                // P0-1 验证（装后四态）
                El('button', {
                  className: `${styles.btn} ${styles.btnSm} ${styles.btnGhost}`,
                  disabled: updating !== null || busy || !i.pluginId || verifying !== null,
                  onClick: () => void verifyOne(i),
                }, verifying === i.localName ? '验证中…' : '验证'),
                // P0-2 构建放行中（自动流程的过渡态）
                approving === i.localName
                  ? El('span', { className: styles.updateHint }, '放行构建脚本…')
                  : null,
                updateMap[i.localName]?.hasUpdate
                  ? El('button', {
                      className: `${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`,
                      disabled: updating !== null || busy,
                      onClick: () => void updatePlugin(i),
                    }, updating === i.localName ? '更新中…' : '更新')
                  : null,
                El('button', {
                  className: `${styles.btn} ${styles.btnSm}`,
                  disabled: !i.pluginId,
                  onClick: () => setConfirming(i.localName),
                }, '卸载'),
              ),
        ),
      ),
    ),
    unmatched.length > 0
      ? El('div', { className: styles.section },
          El('div', { className: styles.sectionHead },
            El(Icon, { d: ICON_PACKAGE, size: 14, className: styles.sectionIcon }),
            El('h3', { className: styles.sectionTitle }, '其他已装'),
            El('span', { className: styles.sectionNote }, `${unmatched.length} 个 · 未收录市场`),
          ),
          El('div', { className: styles.unmatched },
            ...unmatched.slice(0, showAllUnmatched ? unmatched.length : 5).map((i, idx) =>
              El('span', { key: `${i.localName}-${idx}`, className: styles.unmatchedChip }, i.localName),
            ),
            unmatched.length > 5
              ? El('button', {
                  type: 'button',
                  className: `${styles.btn} ${styles.btnGhost} ${styles.btnSm}`,
                  onClick: () => setShowAllUnmatched((v) => !v),
                }, showAllUnmatched ? '收起' : `查看详细（${unmatched.length} 个）`)
              : null,
          ),
        )
      : null,
  )
}

// ---------- 设置 Tab ----------

function SettingsTab(props: {
  profile: UserProfile | null
  onChanged: () => void
}): ReactNode {
  const { profile, onChanged } = props
  const [ghLogin, setGhLogin] = useState<string | null>(() => localStorage.getItem(GH_LOGIN_KEY))
  const [ghBusy, setGhBusy] = useState(false)
  const [ghError, setGhError] = useState('')
  const [deviceInfo, setDeviceInfo] = useState<{ verification_uri: string; user_code: string } | null>(null)
  const [patInput, setPatInput] = useState('')
  const [mode, setMode] = useState<string>(profile?.modeOverride ?? 'auto')
  const [profileName, setProfileName] = useState('web')
  // 版本信息（设置页「关于」显示；Host config 读取已装包版本）
  const [versions, setVersions] = useState<Record<string, string>>({})

  useEffect(() => {
    setMode(profile?.modeOverride ?? 'auto')
    void api<{ versions?: Record<string, string> }>('config').then((c) => {
      if (c?.versions) setVersions(c.versions)
    }).catch(() => {})
  }, [profile])

  const saveSettings = async (patch: Record<string, unknown>) => {
    try {
      await api('settings:update', { patch })
      onChanged()
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    }
  }

  // 设备流阶段状态（诊断 + 用户体验）
  const [ghPoll, setGhPoll] = useState<'idle' | 'waiting' | 'polling' | 'finishing' | 'done'>('idle')
  const [pollDetail, setPollDetail] = useState('')
  const [pollCount, setPollCount] = useState(0)
  // 轮询 interval 管理：保证同时只有一个轮询，卸载/重开时清理
  const pollIntervalRef = useRef<number | null>(null)
  const clearPoll = () => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }
  useEffect(() => clearPoll, [])

  // 设备流：申请 code → 显示 → 轮询 token
  const startDeviceFlow = async () => {
    clearPoll() // 先停掉旧轮询（防多个 device_code 并发）
    setGhBusy(true)
    setGhError('')
    setDeviceInfo(null)
    setGhPoll('waiting')
    try {
      const d = await api<{
        device_code?: string
        user_code?: string
        verification_uri?: string
        interval?: number
        error?: string
        error_description?: string
      }>('gh:deviceCode', {
        body: { client_id: GH_CLIENT_ID, scope: 'read:user' },
      })
      if (!d.device_code) {
        setGhError(`设备流不可用：${d.error_description ?? d.error ?? '未知错误'}`)
        setGhPoll('idle')
        setGhBusy(false)
        return
      }
      setDeviceInfo({ verification_uri: d.verification_uri ?? '', user_code: d.user_code ?? '' })
      setGhPoll('polling')
      setPollCount(0)
      setPollDetail('第 1 次轮询…')
      let localCount = 0
      // 轮询 token（只保留一个 interval；卸载/重开时清理）
      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const t = await api<{ access_token?: string; error?: string; error_description?: string }>('gh:token', {
            body: {
              client_id: GH_CLIENT_ID,
              device_code: d.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            },
          })
          localCount++
          setPollCount(localCount)
          if (t.access_token) {
            clearPoll()
            setGhPoll('finishing')
            setPollDetail('拿到 token，正在同步加星…')
            await finishBind(t.access_token, 'device')
            setGhPoll('done')
          } else if (t.error === 'authorization_pending') {
            setPollDetail(`第 ${localCount} 次：GitHub 尚未确认授权（继续等待…）`)
          } else if (t.error === 'slow_down') {
            setPollDetail(`第 ${localCount} 次：GitHub 要求放慢轮询（继续等待…）`)
          } else {
            clearPoll()
            setGhError(t.error_description ?? t.error ?? '授权失败')
            setGhPoll('idle')
            setGhBusy(false)
          }
        } catch (e) {
          clearPoll()
          setGhError((e as Error).message)
          setGhPoll('idle')
          setGhBusy(false)
        }
      }, (d.interval ?? 5) * 1000)
    } catch (e) {
      setGhError((e as Error).message)
      setGhBusy(false)
    }
  }

  // 绑定完成：验证身份 → 存 token → 拉加星 → 更新画像
  const finishBind = async (token: string, method: 'device' | 'pat') => {
    try {
      const user = await api<{ login: string }>('gh:user', { token })
      localStorage.setItem(GH_TOKEN_KEY, token)
      localStorage.setItem(GH_LOGIN_KEY, user.login)
      localStorage.setItem(GH_METHOD_KEY, method)
      setGhLogin(user.login)
      setGhBusy(false)
      setDeviceInfo(null)
      // 拉加星 → 更新画像 → 刷新
      const starred = await api<string[]>('gh:starred', { token })
      await api('profile:update', { starredFullNames: starred })
      onChanged()
    } catch (e) {
      setGhError(`绑定失败：${(e as Error).message}`)
      setGhBusy(false)
    }
  }

  const bindWithPat = async () => {
    if (!patInput.trim()) return
    setGhBusy(true)
    setGhError('')
    try {
      await finishBind(patInput.trim(), 'pat')
      setPatInput('')
    } catch (e) {
      setGhError((e as Error).message)
      setGhBusy(false)
    }
  }

  const unbind = () => {
    localStorage.removeItem(GH_TOKEN_KEY)
    localStorage.removeItem(GH_LOGIN_KEY)
    localStorage.removeItem(GH_METHOD_KEY)
    setGhLogin(null)
    onChanged()
  }

  return El('div', { className: styles.tabBody },
    // GitHub 绑定卡片
    El('div', { className: styles.settingCard },
      El('div', { className: styles.settingHead },
        El('span', { className: styles.settingIc }, El(Icon, { d: ICON_GITHUB, size: 15 })),
        El('span', { className: styles.settingTitle }, 'GitHub 账户'),
        El('span', {
          className: `${styles.settingStatus} ${ghLogin ? styles.statusOk : styles.statusOff}`,
        }, ghLogin ? '已绑定' : '未绑定'),
      ),
      ghLogin
        ? El('div', null,
            El('p', { className: styles.ghTip }, `已绑定 @${ghLogin}，读取公开加星用于个性化推荐（token 仅存本机浏览器）。`),
            El('div', { className: styles.settingsRow },
              El('button', { className: `${styles.btn} ${styles.btnSm}`, onClick: unbind }, '解除绑定'),
            ),
          )
        : El('div', null,
            El('div', { className: styles.fieldRow },
              El('div', { className: styles.field },
                El('label', { className: styles.fieldLabel }, 'Token（Personal Access Token）'),
                El('input', {
                  className: styles.input,
                  type: 'password',
                  placeholder: 'ghp_…',
                  value: patInput,
                  onChange: (e: { target: { value: string } }) => setPatInput(e.target.value),
                }),
              ),
            ),
            El('div', { className: styles.settingsRow },
              El('button', {
                className: `${styles.btn} ${styles.btnPrimary}`,
                disabled: ghBusy,
                onClick: () => void bindWithPat(),
              }, 'Token 绑定（完整功能）'),
              El('button', {
                className: styles.btn,
                disabled: ghBusy,
                onClick: () => void startDeviceFlow(),
              }, '快速授权（仅推荐）'),
            ),
            El('p', { className: styles.ghTip },
              'Token 绑定 = 完整功能（读取加星推荐 + 一键加星）；快速授权只能读取公开加星做推荐。',
              ' ',
              El('a', {
                href: 'https://github.com/settings/tokens/new?scopes=public_repo,read:user&description=dsh-market',
                target: '_blank',
                rel: 'noopener noreferrer',
                className: styles.ghLink,
              }, '生成 Token（public_repo + read:user）',
                El(Icon, { d: ICON_EXTERNAL, size: 11, className: styles.inlineIcon })),
            ),
            deviceInfo
              ? El('div', { className: styles.deviceFlow },
                  El('p', null, '在 GitHub 输入授权码：'),
                  El('code', { className: styles.deviceCode }, deviceInfo.user_code),
                  El('p', null,
                    El('a', { href: deviceInfo.verification_uri, target: '_blank', rel: 'noopener noreferrer' },
                      '前往 GitHub 授权',
                      El(Icon, { d: ICON_EXTERNAL, size: 11, className: styles.inlineIcon })),
                  ),
                  El('p', { className: styles.deviceFlowTip },
                    '输入授权码后，请点击 GitHub 页面上的「Authorize / 授权」按钮完成确认，然后回到这里等待自动绑定。',
                  ),
                  El('p', { className: styles.ghPollState },
                    ghPoll === 'polling'
                      ? pollDetail || '等待授权…（授权完成后自动绑定）'
                      : ghPoll === 'finishing'
                        ? pollDetail || '授权成功，正在同步加星…'
                        : ghPoll === 'done'
                          ? El('span', { className: styles.ghDone },
                              El(Icon, { d: ICON_CHECK, size: 13, className: styles.inlineIcon }),
                              '绑定完成')
                          : '',
                  ),
                  ghPoll === 'polling' && pollCount >= 36
                    ? El('p', { className: styles.deviceFlowTip },
                        '已等待较久：请确认 GitHub 页面已完成「Authorize」确认；若授权码已过期（15 分钟），点「重新获取授权码」。',
                      )
                    : null,
                  El('button', {
                    className: `${styles.btn} ${styles.btnSm}`,
                    disabled: ghBusy,
                    onClick: () => void startDeviceFlow(),
                  }, '重新获取授权码'),
                )
              : null,
            ghError ? El('p', { className: styles.error }, ghError) : null,
          ),
    ),
    // 推荐偏好卡片
    El('div', { className: styles.settingCard },
      El('div', { className: styles.settingHead },
        El('span', { className: styles.settingIc }, El(Icon, { d: ICON_MODE, size: 15 })),
        El('span', { className: styles.settingTitle }, '推荐偏好'),
      ),
      El('div', { className: styles.field },
        El('label', { className: styles.fieldLabel }, '推荐模式'),
        El('select', {
          className: styles.select,
          value: mode,
          onChange: (e: { target: { value: string } }) => {
            setMode(e.target.value)
            void saveSettings({ modeOverride: e.target.value })
          },
        },
          El('option', { value: 'auto' }, '自动（按画像判断）'),
          El('option', { value: 'novice' }, '新手模式'),
          El('option', { value: 'veteran' }, '个性化模式'),
        ),
      ),
      El('div', { className: styles.field },
        El('label', { className: styles.fieldLabel }, '目标 Profile'),
        El('input', {
          className: styles.input,
          value: profileName,
          onChange: (e: { target: { value: string } }) => {
            setProfileName(e.target.value)
            void saveSettings({ profile: e.target.value })
          },
        }),
      ),
      El('p', { className: styles.ghTip }, `已装 skill 目录：从本机 skills 目录自动检测`),
      El('div', { className: styles.dividerLine }),
      El('button', { className: styles.btn, onClick: onChanged }, '刷新推荐数据'),
    ),
    // 关于卡片
    El('div', { className: styles.settingCard },
      El('div', { className: styles.settingHead },
        El('span', { className: styles.settingIc }, El(Icon, { d: ICON_CLOCK, size: 15 })),
        El('span', { className: styles.settingTitle }, '关于'),
      ),
      El('p', { className: styles.ghTip },
        '数据缓存于本地（GitHub Actions 每日抓取）。',
      ),
      versions['@dsh-market/plugin']
        ? El('div', { className: styles.versionRow },
            El('span', { className: styles.versionLabel }, '插件版本'),
            El('code', { className: styles.versionCode },
              `${versions['@dsh-market/plugin'] ?? '?'}`,
              versions['@dsh-market/core'] ? ` · core ${versions['@dsh-market/core']}` : '',
            ),
          )
        : null,
    ),
  )
}

// ---------- 整合包 Tab ----------
function PacksTab(props: {
  packs: LitePack[]
  onInstallPack: (pack: LitePack) => void
}) {
  const { packs } = props
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const ql = query.trim().toLowerCase()

  const visible = [...packs]
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .filter((p) =>
      !ql ||
      p.name.toLowerCase().includes(ql) ||
      (p.descriptionZh ?? '').toLowerCase().includes(ql) ||
      p.author.toLowerCase().includes(ql) ||
      p.tags.some((t) => t.toLowerCase().includes(ql)),
    )

  return El('div', { className: styles.tabBody },
    El('div', { className: styles.searchWrap },
      El('span', { className: styles.searchWrapIcon }, El(Icon, { d: ICON_SEARCH, size: 15 })),
      El('input', {
        className: styles.searchInput,
        placeholder: '搜索整合包：翻译 / 安全 / MCP / 环境…',
        value: query,
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
      query.length > 0
        ? El('button', { className: styles.searchClear, 'aria-label': '清除', onClick: () => setQuery('') },
            El(Icon, { d: ICON_CLOSE, size: 13 }))
        : null,
    ),
    packs.length === 0
      ? El('div', { className: styles.emptyState },
          '整合包正式协议开发中，暂未开放收录——敬请期待。',
        )
      : visible.length === 0
        ? El('div', { className: styles.emptyState }, '没有匹配的整合包，换个关键词试试。')
        : El('div', { className: styles.list, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            ...visible.map((p) => {
              const { total, ok, inMarket } = p.entryStats
              const rate = total > 0 ? Math.round((ok / total) * 100) : 0
              const open = expanded === p.id
              return El('div', { key: p.id, className: styles.card },
                El('div', { className: styles.cardTop },
                  El('span', { className: styles.cardStars, style: { background: '#F3EFFF', color: '#7C3AED', borderRadius: 6, padding: '2px 8px', fontSize: 10 } }, 'PACK'),
                  El('span', { className: styles.cardStars }, `★ ${fmtStars(p.stars)}`),
                ),
                El('div', { className: styles.cardName }, p.name),
                El('div', { className: styles.cardDesc }, p.descriptionZh ?? '（无简介）'),
                El('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: rate >= 80 ? '#1E7A46' : rate >= 50 ? '#B26A00' : '#B33A3A', padding: '4px 8px', borderRadius: 6, background: '#F6F8FB', marginBottom: 8 } },
                  `✓ ${ok}/${total} 条目可解析 · ${inMarket} 已在市场`,
                  El('b', {}, `${rate}%`),
                ),
                El('div', { className: styles.cardActions },
                  El('span', { style: { fontSize: 12, fontWeight: 600, color: '#7C3AED' } }, `${p.scoreTotal} 实用分`),
                  El('button', {
                    className: `${styles.btn} ${styles.btnSm} ${styles.btnGhost}`,
                    onClick: () => setExpanded(open ? null : p.id),
                  }, open ? '收起条目' : '查看条目'),
                ),
                open
                  ? El('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, paddingTop: 8, borderTop: '1px solid #EEF2F7' } },
                      ...p.entries.map((e, i) =>
                        El('div', {
                          key: `${e.id}-${i}`,
                          style: {
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                            color: e.resolved?.ok ? 'inherit' : '#B33A3A', padding: '3px 0',
                          },
                        },
                          El('span', {}, e.resolved?.ok ? '✓' : '✗'),
                          El('code', { style: { fontSize: 10.5 } }, e.id),
                          El('span', { style: { fontSize: 10, color: '#8CA3BB' } }, e.type),
                          El('span', { style: { marginLeft: 'auto', fontSize: 10, color: '#8CA3BB' } },
                            e.resolved?.ok
                              ? (e.resolved.inMarket ? '已在市场' : '可安装')
                              : (e.resolved?.reason ?? '解析失败')),
                        ),
                      ),
                    )
                  : null,
              )
            }),
          ),
  )
}

// ---------- 收藏 Tab ----------

function FavoritesTab(props: {
  plugins: LitePlugin[]
  onInstall: (p: LitePlugin) => void
  onTagClick: (t: string) => void
  refreshTick: number
  onGotoRecommend: () => void
}): ReactNode {
  const { plugins, onInstall, onTagClick, refreshTick, onGotoRecommend } = props
  // refreshTick 变化时重读收藏
  const favIds = useMemo(() => readFavorites(), [refreshTick])
  const items = plugins.filter((p) => favIds.includes(p.id))
  return El('div', { className: styles.tabBody },
    El('div', { className: styles.sectionHead },
      El(Icon, { d: ICON_STAR_OUTLINE, size: 14, className: styles.sectionIcon }),
      El('h3', { className: styles.sectionTitle }, '我的收藏'),
      El('span', { className: styles.sectionNote }, `${items.length} 个`),
    ),
    items.length === 0
      ? El('div', { className: styles.emptyState },
          El('div', { className: styles.emptyIcon }, El(Icon, { d: ICON_STAR_OUTLINE, size: 44 })),
          El('div', { className: styles.emptyTitle }, '还没有收藏任何插件'),
          El('div', { className: styles.emptyDesc }, '在推荐或搜索页点击星标，把喜欢的插件收藏到这里。'),
          El('button', { className: `${styles.btn} ${styles.btnPrimary}`, onClick: onGotoRecommend }, '去逛逛'),
        )
      : El('div', { className: styles.grid2 },
          ...items.map((p) =>
            El(PluginCard, {
              key: p.id,
              plugin: p,
              onInstall,
              onTagClick,
            }),
          ),
        ),
  )
}

// ---------- 主面板 ----------

export function MarketPanel(props: { onClose: () => void }): ReactNode {
  const { onClose } = props
  const open = useSyncExternalStore(subscribe, getOpen, getOpen)
  const [tab, setTab] = useState<'recommend' | 'search' | 'packs' | 'favorites' | 'installed' | 'settings'>('recommend')
  const [plugins, setPlugins] = useState<LitePlugin[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [installed, setInstalled] = useState<InstalledItem[]>([])
  const [packs, setPacks] = useState<LitePack[]>([])
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [installTarget, setInstallTarget] = useState<LitePlugin | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // 手动场景推荐（读真实会话上下文，点击才触发）
  const [sceneState, setSceneState] = useState<{ loading: boolean; recs: Recommendation[]; sceneTags: string[] }>({
    loading: false,
    recs: [],
    sceneTags: [],
  })
  // 插件自身更新提示（打开面板自动检测 npm 最新版；有新版 → 顶部提示条）
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateInfo | null>(null)
  const [selfUpdating, setSelfUpdating] = useState(false)
  const [selfDismissed, setSelfDismissed] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [pl, prof, inst, pk] = await Promise.all([
        api<LitePlugin[]>('plugins'),
        api<UserProfile | null>('profile:read'),
        api<InstalledItem[]>('installed'),
        api<LitePack[]>('packs').catch(() => [] as LitePack[]),
      ])
      setPlugins(pl)
      setProfile(prof)
      setInstalled(inst)
      setPacks(pk)
      // 场景推荐改为手动触发（读会话有成本），默认用已装插件标签近似兜底
      const counts = new Map<string, number>()
      for (const i of inst) {
        if (!i.plugin) continue
        for (const t of i.plugin.tags) {
          if (!/[\u4e00-\u9fff]/.test(t)) continue
          if (['效率工具', '开发辅助', 'AI 增强', 'AI增强'].includes(t)) continue
          counts.set(t, (counts.get(t) ?? 0) + 1)
        }
      }
      const sceneTags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t)
      const excludeIds = inst.filter((i) => i.pluginId).map((i) => i.pluginId!)
      const r = await api<Recommendation[]>('recommend', {
        options: { limit: 24, excludeIds, sceneTags },
      })
      setRecs(r)
    } catch (e) {
      console.error('market load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void loadAll()
  }, [open, refreshKey])

  // 插件自身更新自动检测（打开面板时触发一次，force 刷新 npm 查询缓存）
  useEffect(() => {
    if (!open || selfDismissed) return
    api<SelfUpdateInfo>('update:self', { force: true })
      .then((r) => setSelfUpdate(r))
      .catch(() => {})
  }, [open, selfDismissed])

  /** 插件自身更新：引导式（P0）——运行中不能就地覆盖自己，给出停 harness 后的命令并复制 */
  const applySelfUpdate = async () => {
    setSelfUpdating(true)
    try {
      const r = await api<SelfUpdateInfo>('update:self', { apply: true })
      if (r.needsManual) {
        const cmd = r.manualCommand ?? 'dsh plugin --profile web add @dsh-market/plugin@latest'
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(cmd).catch(() => {})
        }
        toast(`已复制更新命令：${cmd}。请停止 harness 后运行，再重启 harness 生效。`, 5600)
        setSelfDismissed(true)
        return
      }
      if (r.applied) {
        setSelfUpdate(null)
        setSelfDismissed(true)
        toast(`插件更新完成（${r.latest}），重启 harness 后生效`)
      } else {
        toast(`更新失败：${r.applyOutput ?? '未知错误'}。若提示文件被占用，需先停止 harness 后重试`, 5000)
      }
    } catch (e) {
      toast(`更新失败：${(e as Error).message}。若提示文件被占用，需先停止 harness 后重试`, 5000)
    } finally {
      setSelfUpdating(false)
    }
  }

  if (!open) return null

  const installedIds = new Set(installed.filter((i) => i.pluginId).map((i) => i.pluginId!))
  const onTagClick = (t: string) => {
    setSearchSeed(t)
    setTab('search')
  }
  const onInstalledChanged = () => setRefreshKey((k) => k + 1)

  // 手动获取场景推荐：读当前会话上下文 → 标签 → 推荐（场景分区）
  const onFetchScene = async () => {
    setSceneState({ loading: true, recs: [], sceneTags: [] })
    try {
      const scene = await api<{ sceneTags: string[] }>('scene:context')
      const tags = scene.sceneTags ?? []
      if (tags.length === 0) {
        setSceneState({ loading: false, recs: [], sceneTags: [] })
        return
      }
      const excludeIds = installed.filter((i) => i.pluginId).map((i) => i.pluginId!)
      const r = await api<Recommendation[]>('recommend', {
        options: { limit: 24, excludeIds, sceneTags: tags },
      })
      setSceneState({ loading: false, recs: r.filter((x) => x.origin === 'scene'), sceneTags: tags })
    } catch (e) {
      console.error('fetch scene failed:', e)
      setSceneState({ loading: false, recs: [], sceneTags: [] })
    }
  }

  // 新手/个性化模式一键切换（不依赖自动推断的画像说明）
  const onSwitchMode = async () => {
    const cur = profile?.modeOverride ?? 'auto'
    const isNoviceNow = cur === 'novice' || (cur === 'auto' && (profile?.confidence ?? 0) < 0.4)
    const next = isNoviceNow ? 'auto' : 'novice'
    try {
      await api('settings:update', { patch: { modeOverride: next } })
      // 切到新手模式 → 触发问卷重新弹出
      if (next === 'novice') markQuizTriggered()
      onInstalledChanged()
    } catch (e) {
      console.error('switch mode failed:', e)
    }
  }

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'recommend', label: '推荐' },
    { id: 'search', label: '搜索' },
    { id: 'packs', label: '整合包' },
    { id: 'favorites', label: '收藏' },
    { id: 'installed', label: '已装' },
    { id: 'settings', label: '设置' },
  ]

  return El('div', { className: styles.backdrop, onClick: onClose },
    El('div', { className: styles.panel, onClick: (e: MouseEvent) => e.stopPropagation() },
      El('div', { className: styles.header },
        El('span', { className: styles.titleIcon },
          El(MarketLogo, { size: 24, color: '#4D6BFE', eyeColor: '#FFFFFF' }),
        ),
        El('span', { className: styles.title }, '插件市场'),
        El('span', { className: styles.subtitle }, `${plugins.length} 个插件`),
        El('button', { className: styles.headerClose, onClick: onClose, 'aria-label': '关闭' },
          El(Icon, { d: ICON_CLOSE, size: 14 })),
      ),
      selfUpdate?.hasUpdate
        ? El('div', { className: styles.selfUpdateBar },
            El('span', { className: styles.selfUpdateText },
              selfUpdating
                ? '正在更新插件…'
                : `插件有新版本 ${selfUpdate.current ?? '?'} → ${selfUpdate.latest ?? '?'}`),
            selfUpdating
              ? null
              : El('button', {
                  className: `${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`,
                  onClick: () => void applySelfUpdate(),
                }, '获取命令'),
            selfUpdating
              ? null
              : El('button', {
                  className: `${styles.btn} ${styles.btnSm} ${styles.btnGhost}`,
                  onClick: () => setSelfDismissed(true),
                }, '忽略'),
          )
        : null,
      El('div', { className: styles.tabs },
        ...tabs.map((t) =>
          El('button', {
            key: t.id,
            className: `${styles.tab} ${tab === t.id ? styles.tabOn : ''}`,
            onClick: () => setTab(t.id),
          }, t.label),
        ),
      ),
      El('div', { className: styles.body },
        tab === 'recommend'
          ? El(RecommendTab, {
              plugins,
              profile,
              recs,
              loading,
              installedIds,
              onInstall: setInstallTarget,
              onTagClick,
              onSwitchMode,
              onQuizSubmit: async (tags: string[]) => {
                await api('profile:update', { quizTags: tags })
                onInstalledChanged()
              },
              sceneState,
              onFetchScene,
            })
          : tab === 'search'
            ? El(SearchTab, { plugins, onInstall: setInstallTarget, onTagClick })
            : tab === 'packs'
              ? El(PacksTab, {
                  packs,
                  onInstallPack: (pack: LitePack) => {
                    // v0.1：打开整合包仓库页，由包作者提供安装方式
                    window.open(`https://github.com/${pack.id}`, '_blank')
                  },
                })
              : tab === 'favorites'
              ? El(FavoritesTab, {
                  plugins,
                  onInstall: setInstallTarget,
                  onTagClick,
                  refreshTick: refreshKey,
                  onGotoRecommend: () => setTab('recommend'),
                })
              : tab === 'installed'
                ? El(InstalledTab, { installed, loading, onChanged: onInstalledChanged })
                : El(SettingsTab, { profile, onChanged: onInstalledChanged }),
      ),
      installTarget
        ? El(InstallModal, {
            plugin: installTarget,
            onDone: onInstalledChanged,
            onClose: () => setInstallTarget(null),
          })
        : null,
    ),
  )
}
