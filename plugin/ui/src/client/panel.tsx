/**
 * 插件市场面板（4-tab：推荐 / 搜索 / 已装 / 设置）
 * 数据全部来自 Host RPC（api.ts）。纯 React.createElement（无 JSX）。
 */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  api,
  type InstalledItem,
  type InstallStepView,
  type LitePlugin,
  type Recommendation,
  type UserProfile,
} from './api.ts'
import { getOpen, setOpen, subscribe } from './store.ts'
import styles from './styles.module.css'

/** GitHub 设备流 client_id（dsh-market GitHub App，公开值非机密） */
const GH_CLIENT_ID = 'Iv23liYFieChYuBJklZp'
const GH_TOKEN_KEY = 'dsh-market:gh_token'
const GH_LOGIN_KEY = 'dsh-market:gh_login'

/** 跨 tab 搜索词（标签点击 → 搜索 tab） */
let searchSeed = ''
function setSearchSeed(t: string): void {
  searchSeed = t
}

// ---------- 通用小组件 ----------

function fmtStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function El(tag: string | ((props: any) => ReactNode), props: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return createElement(tag as never, props ?? {}, ...children)
}

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
  return El('div', { className: styles.card, 'data-type': plugin.type },
    El('div', { className: styles.cardHead },
      El('span', { className: styles.cardName, title: plugin.fullName }, plugin.name),
      El('span', { className: styles.cardMeta },
        plugin.type === 'skill' ? 'SKILL' : '插件',
        ' · ',
        fmtStars(plugin.stars),
        '★ · ',
        plugin.scoreTotal,
        '分',
      ),
    ),
    plugin.descriptionZh
      ? El('p', { className: styles.cardDesc }, plugin.descriptionZh)
      : null,
    El('div', { className: styles.cardTags },
      ...tags.map((t) =>
        El('span', { key: t, className: styles.tag, onClick: () => onTagClick(t) }, t),
      ),
    ),
    reasons && reasons.length > 0
      ? El('div', { className: styles.cardReasons },
          ...reasons.map((r, i) => El('span', { key: i, className: styles.reason }, r)),
        )
      : null,
    El('div', { className: styles.cardActions },
      plugin.needsConfig ? El('span', { className: styles.needConfig }, '需配置') : null,
      El('button', { className: styles.btnPrimary, onClick: () => onInstall(plugin) }, '安装'),
    ),
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

  // AI 代理安装：交给 harness 的子代理（读 README → 确认配置 → 执行 → 验证）
  const startAi = async () => {
    setPhase('running')
    try {
      const r = await api<{ started: boolean; childSessionId: string | null }>('ai:install', {
        pluginId: plugin.id,
      })
      setChildSessionId(r.childSessionId)
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
      El('div', { className: styles.modalHead },
        El('span', { className: styles.modalTitle }, `安装 ${plugin.name}`),
        El('button', { className: styles.btnGhost, onClick: onClose }, '✕'),
      ),
      phase === 'confirm'
        ? El('div', { className: styles.modalBody },
            El('p', { className: styles.modalDesc },
              `将交由 AI 助手阅读 ${plugin.fullName} 的文档后自动安装，需要配置（API Key / Token）时会先向你确认。`,
            ),
            plugin.needsConfig
              ? El('p', { className: styles.warn }, '⚠️ 该插件需要额外配置（API Key / Token），AI 会向你询问。')
              : null,
            plugin.type === 'skill'
              ? El('p', { className: styles.ghTip }, '目标：技能目录（~/.agents/skills）')
              : El('p', { className: styles.ghTip }, '目标：web profile（装完需重启 harness 生效）'),
            El('div', { className: styles.modalActions },
              El('button', { className: styles.btnGhost, onClick: onClose }, '取消'),
              El('button', { className: styles.btnPrimary, onClick: () => void startAi() }, '确认，交给 AI 安装'),
            ),
            El('details', { className: styles.advanced },
              El('summary', null, '高级：查看/复制手动命令'),
              El('code', { className: styles.advancedCmd }, cmd),
            ),
          )
        : phase === 'running'
          ? El('div', { className: styles.modalBody },
              El('div', { className: styles.loading }, '正在唤起 AI 助手…'),
            )
          : phase === 'handedOff'
            ? El('div', { className: styles.modalBody },
                El('div', { className: styles.modalSuccess }, '✅ 已交给 AI 助手安装'),
                El('p', { className: styles.modalDesc },
                  childSessionId
                    ? `AI 助手已开始工作（子会话 ${childSessionId.slice(0, 8)}…），请到会话中查看进度；需要配置时 AI 会向你确认。`
                    : 'AI 助手已开始工作，请到会话中查看进度；需要配置时 AI 会向你确认。',
                ),
                El('div', { className: styles.modalActions },
                  El('button', { className: styles.btnPrimary, onClick: () => { onDone(); onClose() } }, '知道了'),
                ),
              )
            : El('div', { className: styles.modalBody },
                El('div', { className: styles.modalError }, `❌ 启动失败：${error}`),
                El('div', { className: styles.modalActions },
                  El('button', { className: styles.btnGhost, onClick: () => setPhase('confirm') }, '重试'),
                  El('button', { className: styles.btnPrimary, onClick: onClose }, '关闭'),
                ),
              ),
    ),
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
}): ReactNode {
  const { profile, recs, loading, installedIds, onInstall, onTagClick } = props
  if (loading) return El('div', { className: styles.stateHint }, '加载推荐中…')
  if (recs.length === 0) return El('div', { className: styles.stateHint }, '暂无推荐，先去搜索或完成问卷吧')

  const stage = !profile
    ? '新手'
    : profile.modeOverride !== 'auto'
      ? profile.modeOverride
      : profile.confidence >= 0.4
        ? '老手'
        : '新手'
  const groups: Array<{ title: string; items: Recommendation[] }> = [
    { title: '🎯 适合当前场景', items: recs.filter((r) => r.origin === 'scene') },
    { title: '🤔 猜你喜欢', items: recs.filter((r) => r.origin === 'guess') },
    { title: '⭐ 精选', items: recs.filter((r) => r.origin === 'curated') },
    { title: '🆕 最近更新', items: recs.filter((r) => r.origin === 'trending') },
  ].filter((g) => g.items.length > 0)

  return El('div', { className: styles.tabBody },
    profile
      ? El('div', { className: styles.stageBadge },
          `阶段：${stage} · 画像置信度 ${Math.round((profile.confidence ?? 0) * 100)}%`,
        )
      : null,
    ...groups.map((g) =>
      El('div', { key: g.title, className: styles.section },
        El('h3', { className: styles.sectionTitle }, g.title),
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
  const [results, setResults] = useState<Array<{ plugin: LitePlugin; relevance: number; tagHits: number }>>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 从标签点击带入的初始查询
  useEffect(() => {
    if (searchSeed) {
      setQuery(searchSeed)
      setSearchSeed('')
    }
  }, [])

  const hot = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of plugins) {
      for (const t of p.tags) {
        if (!/[\u4e00-\u9fff]/.test(t)) continue
        if (['效率工具', '开发辅助', 'AI 增强', 'AI增强'].includes(t)) continue
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t)
  }, [plugins])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch()
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, tags, type])

  const runSearch = async () => {
    setSearching(true)
    try {
      const opts: Record<string, unknown> = { limit: 50 }
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
    El('div', { className: styles.searchRow },
      El('input', {
        className: styles.searchInput,
        placeholder: '搜索插件：名称 / 功能 / 用途…',
        value: query,
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
    ),
    El('div', { className: styles.filterRow },
      El('select', {
        className: styles.select,
        value: type,
        onChange: (e: { target: { value: string } }) => setType(e.target.value),
      },
        El('option', { value: 'all' }, '全部类型'),
        El('option', { value: 'cordis-plugin' }, 'cordis 插件'),
        El('option', { value: 'skill' }, 'skill'),
      ),
    ),
    El('div', { className: styles.tagCloud },
      ...hot.map((t) =>
        El('span', {
          key: t,
          className: `${styles.tag} ${tags.includes(t) ? styles.tagOn : ''}`,
          onClick: () => toggleTag(t),
        }, t),
      ),
    ),
    searching && results.length === 0
      ? El('div', { className: styles.stateHint }, '搜索中…')
      : results.length === 0 && query === '' && tags.length === 0
        ? El('div', { className: styles.stateHint }, '输入关键词或选择标签开始搜索')
        : results.length === 0
          ? El('div', { className: styles.stateHint }, '没有匹配的插件')
          : El('div', { className: styles.results },
              El('div', { className: styles.resultCount }, `共 ${results.length} 个结果`),
              ...results.slice(0, 30).map((r) =>
                El(PluginCard, {
                  key: r.plugin.id,
                  plugin: r.plugin,
                  reasons: r.tagHits > 0 ? [`标签命中 ${r.tagHits} 项`] : undefined,
                  onInstall,
                  onTagClick,
                }),
              ),
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

  const uninstall = async (item: InstalledItem) => {
    if (!item.pluginId) return
    setBusy(true)
    try {
      await api('uninstall', { pluginId: item.pluginId })
      onChanged()
    } catch (e) {
      alert(`卸载失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  if (loading) return El('div', { className: styles.stateHint }, '扫描已装插件…')
  const matched = installed.filter((i) => i.pluginId)
  const unmatched = installed.filter((i) => !i.pluginId)

  return El('div', { className: styles.tabBody },
    El('div', { className: styles.section },
      El('h3', { className: styles.sectionTitle }, `已装插件（${installed.length}）`),
      matched.length === 0 ? El('div', { className: styles.stateHint }, '未检测到市场收录的已装插件') : null,
      ...matched.map((i) =>
        El('div', { key: i.localName, className: styles.installedRow },
          El('div', { className: styles.installedInfo },
            El('div', { className: styles.installedName }, i.plugin?.name ?? i.localName),
            El('div', { className: styles.installedMeta },
              `${i.version ?? '未知版本'} · ${i.source === 'skills' ? 'skill' : 'profile'}`,
            ),
          ),
          confirming === i.localName
            ? El('div', { className: styles.installedActions },
                El('button', { className: styles.btnGhost, onClick: () => setConfirming(null) }, '取消'),
                El('button', {
                  className: styles.btnDanger,
                  disabled: busy,
                  onClick: () => void uninstall(i),
                }, '确认卸载'),
              )
            : El('div', { className: styles.installedActions },
                El('button', {
                  className: styles.btnGhost,
                  disabled: !i.pluginId,
                  onClick: () => setConfirming(i.localName),
                }, '卸载'),
              ),
        ),
      ),
    ),
    unmatched.length > 0
      ? El('div', { className: styles.section },
          El('h3', { className: styles.sectionTitle }, `其他已装（${unmatched.length}，未收录市场）`),
          El('div', { className: styles.unmatched },
            ...unmatched.slice(0, 30).map((i) =>
              El('span', { key: i.localName, className: styles.unmatchedChip }, i.localName),
            ),
            unmatched.length > 30 ? El('span', { className: styles.unmatchedMore }, `+${unmatched.length - 30}`) : null,
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

  useEffect(() => {
    setMode(profile?.modeOverride ?? 'auto')
  }, [profile])

  const saveSettings = async (patch: Record<string, unknown>) => {
    try {
      await api('settings:update', { patch })
      onChanged()
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    }
  }

  // 设备流：申请 code → 显示 → 轮询 token
  const startDeviceFlow = async () => {
    setGhBusy(true)
    setGhError('')
    setDeviceInfo(null)
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
        setGhBusy(false)
        return
      }
      setDeviceInfo({ verification_uri: d.verification_uri ?? '', user_code: d.user_code ?? '' })
      // 轮询 token（浏览器原生定时器；组件卸载时停止）
      const interval = window.setInterval(async () => {
        try {
          const t = await api<{ access_token?: string; error?: string; error_description?: string }>('gh:token', {
            body: {
              client_id: GH_CLIENT_ID,
              device_code: d.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            },
          })
          if (t.access_token) {
            window.clearInterval(interval)
            await finishBind(t.access_token)
          } else if (t.error === 'authorization_pending') {
            // 继续等待
          } else if (t.error === 'slow_down') {
            // 继续等待
          } else {
            window.clearInterval(interval)
            setGhError(t.error_description ?? t.error ?? '授权失败')
            setGhBusy(false)
          }
        } catch (e) {
          window.clearInterval(interval)
          setGhError((e as Error).message)
          setGhBusy(false)
        }
      }, (d.interval ?? 5) * 1000)
    } catch (e) {
      setGhError((e as Error).message)
      setGhBusy(false)
    }
  }

  // 绑定完成：验证身份 → 存 token → 拉加星 → 更新画像
  const finishBind = async (token: string) => {
    try {
      const user = await api<{ login: string }>('gh:user', { token })
      localStorage.setItem(GH_TOKEN_KEY, token)
      localStorage.setItem(GH_LOGIN_KEY, user.login)
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
      await finishBind(patInput.trim())
      setPatInput('')
    } catch (e) {
      setGhError((e as Error).message)
      setGhBusy(false)
    }
  }

  const unbind = () => {
    localStorage.removeItem(GH_TOKEN_KEY)
    localStorage.removeItem(GH_LOGIN_KEY)
    setGhLogin(null)
    onChanged()
  }

  return El('div', { className: styles.tabBody },
    // GitHub 绑定
    El('div', { className: styles.section },
      El('h3', { className: styles.sectionTitle }, 'GitHub 绑定（加星 → 推荐画像）'),
      ghLogin
        ? El('div', { className: styles.ghCard },
            El('div', { className: styles.ghRow },
              El('span', { className: styles.ghLogin }, `已绑定 @${ghLogin}`),
              El('button', { className: styles.btnGhost, onClick: unbind }, '解除绑定'),
            ),
            El('p', { className: styles.ghTip }, '已读取你的公开加星用于个性化推荐（token 仅存本机浏览器）'),
          )
        : El('div', { className: styles.ghCard },
            El('div', { className: styles.ghRow },
              El('button', {
                className: styles.btnPrimary,
                disabled: ghBusy,
                onClick: () => void startDeviceFlow(),
              }, '通过 GitHub 授权绑定'),
              El('button', {
                className: styles.btnGhost,
                disabled: ghBusy,
                onClick: () => void bindWithPat(),
              }, '使用 Token'),
            ),
            deviceInfo
              ? El('div', { className: styles.deviceFlow },
                  El('p', null, '在 GitHub 输入授权码：'),
                  El('code', { className: styles.deviceCode }, deviceInfo.user_code),
                  El('p', null,
                    El('a', { href: deviceInfo.verification_uri, target: '_blank', rel: 'noopener noreferrer' }, '前往 GitHub 授权 ↗'),
                  ),
                )
              : null,
            El('div', { className: styles.settingsRow },
              El('input', {
                className: styles.input,
                placeholder: '或粘贴 Personal Access Token（read:user）',
                value: patInput,
                onChange: (e: { target: { value: string } }) => setPatInput(e.target.value),
              }),
            ),
            ghError ? El('p', { className: styles.error }, ghError) : null,
          ),
    ),
    // 推荐模式
    El('div', { className: styles.section },
      El('h3', { className: styles.sectionTitle }, '推荐模式'),
      El('div', { className: styles.settingsRow },
        El('select', {
          className: styles.select,
          value: mode,
          onChange: (e: { target: { value: string } }) => {
            setMode(e.target.value)
            void saveSettings({ modeOverride: e.target.value })
          },
        },
          El('option', { value: 'auto' }, '自动（按画像置信度）'),
          El('option', { value: 'novice' }, '新手（高分精选 + 引导）'),
          El('option', { value: 'veteran' }, '老手（新颖 + 领域精准）'),
        ),
      ),
    ),
    // 安装目标
    El('div', { className: styles.section },
      El('h3', { className: styles.sectionTitle }, '安装设置'),
      El('div', { className: styles.settingsRow },
        El('label', { className: styles.settingsLabel }, '目标 profile'),
        El('input', {
          className: styles.input,
          value: profileName,
          onChange: (e: { target: { value: string } }) => {
            setProfileName(e.target.value)
            void saveSettings({ profile: e.target.value })
          },
        }),
      ),
      El('p', { className: styles.ghTip }, `已装 skill 目录：从本机 ${'skills 目录'} 自动检测`),
    ),
    // 数据刷新
    El('div', { className: styles.section },
      El('h3', { className: styles.sectionTitle }, '数据'),
      El('button', { className: styles.btnGhost, onClick: onChanged }, '刷新市场数据'),
    ),
  )
}

// ---------- 主面板 ----------

export function MarketPanel(props: { onClose: () => void }): ReactNode {
  const { onClose } = props
  const open = useSyncExternalStore(subscribe, getOpen, getOpen)
  const [tab, setTab] = useState<'recommend' | 'search' | 'installed' | 'settings'>('recommend')
  const [plugins, setPlugins] = useState<LitePlugin[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [installed, setInstalled] = useState<InstalledItem[]>([])
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [installTarget, setInstallTarget] = useState<LitePlugin | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [pl, prof, inst] = await Promise.all([
        api<LitePlugin[]>('plugins'),
        api<UserProfile | null>('profile:read'),
        api<InstalledItem[]>('installed'),
      ])
      setPlugins(pl)
      setProfile(prof)
      setInstalled(inst)
      // 场景标签：从已装插件的中文标签取 top（"你正在用"的近似）
      const sceneTags: string[] = []
      const counts = new Map<string, number>()
      for (const i of inst) {
        if (!i.plugin) continue
        for (const t of i.plugin.tags) {
          if (!/[\u4e00-\u9fff]/.test(t)) continue
          if (['效率工具', '开发辅助', 'AI 增强', 'AI增强'].includes(t)) continue
          counts.set(t, (counts.get(t) ?? 0) + 1)
        }
      }
      for (const [t, c] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) sceneTags.push(t)
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

  if (!open) return null

  const installedIds = new Set(installed.filter((i) => i.pluginId).map((i) => i.pluginId!))
  const onTagClick = (t: string) => {
    setSearchSeed(t)
    setTab('search')
  }
  const onInstalledChanged = () => setRefreshKey((k) => k + 1)

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'recommend', label: '推荐' },
    { id: 'search', label: '搜索' },
    { id: 'installed', label: '已装' },
    { id: 'settings', label: '设置' },
  ]

  return El('div', { className: styles.backdrop, onClick: onClose },
    El('div', { className: styles.panel, onClick: (e: MouseEvent) => e.stopPropagation() },
      El('div', { className: styles.header },
        El('span', { className: styles.title }, '🧩 插件市场'),
        El('span', { className: styles.subtitle }, `${plugins.length} 个插件`),
        El('button', { className: styles.btnGhost, onClick: onClose }, '✕'),
      ),
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
            })
          : tab === 'search'
            ? El(SearchTab, { plugins, onInstall: setInstallTarget, onTagClick })
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
