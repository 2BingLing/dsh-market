/**
 * @dsh-market/plugin client half —— 双路注册（按宿主能力探测，同一份产物兼容两代 DSH）：
 *
 *  A. 0.1.5+ 标准面板入口：`sidebar.panellist`（左栏导航图标）+ `main`（中央面板）。
 *     按契约，panellist 的 `id` 必须与 main 的 `key` 同名——sidebar 点击时调
 *     `layout.selectPanel(id)`，而 selectPanel 会按 key 反查 main 注册项，对不上直接抛错。
 *  B. ≤0.1.4 旧入口：`sidebar.footer.action`（侧栏底部按钮）+ `shell.overlay`（浮层模态）。
 *
 *  探测点：`layout.selectPanel`。两代 `root` slot 的子节点完全不同——旧版是
 *  `sidebar`/`conversation`/`details`/`shell.overlay`（**没有 main、也没有 panellist**），
 *  新版是 `sidebar`/`main`/`rightbar`/`shell.overlay`；layout 服务的方法集同样不重叠：
 *  旧版 `attachPanels/toggleSidebar/openDetails/closeDetails`，新版 `selectPanel/...`。
 *  两代都 `provide('layout')`，故 `inject: ['slots', 'layout']` 在两代均成立；同时 inject
 *  layout 也保证了探测时它已就绪（只 inject slots 的话可能先于 layout 就绪而误判成旧版）。
 */
import { createElement, useSyncExternalStore } from 'react'
import { MarketPanel } from './panel.tsx'
import { getOpen, setOpen, subscribe, toggle } from './store.ts'
import { MarketLogo } from './logo.tsx'
import styles from './styles.module.css'

/** 面板 id == main slot 的 key（两者必须同名，见文件头 A） */
const PANEL_ID = 'dsh-market'

/** 旧版入口按钮：侧边栏底部「设置」旁的图标按钮（issue #101：独占一行 + 16px 图标对齐官方） */
function MarketTrigger(props: { wide: boolean }): React.ReactNode {
  const open = useSyncExternalStore(subscribe, getOpen, getOpen)
  return createElement(
    'button',
    {
      className: styles.trigger,
      onClick: toggle,
      title: '插件市场',
      'aria-label': '插件市场',
      'data-active': open || undefined,
    },
    createElement(
      'span',
      { className: styles.triggerIcon },
      createElement(MarketLogo, {
        size: 16,
        color: open ? 'currentColor' : 'currentColor',
      }),
    ),
    props.wide ? createElement('span', { className: styles.triggerLabel }, '插件市场') : null,
  )
}

/**
 * 0.1.5 左栏导航图标。owner 传入 `{ size, active }`，并把图标渲染在 `.panelRow`
 * 之内（未选中 color=label-secondary、选中=label-primary），所以这里用
 * currentColor 即可自动跟随选中态，不需要自己读 active 改色。
 */
function MarketRailIcon(props: { size: number; active: boolean }): React.ReactNode {
  return createElement(MarketLogo, { size: props.size, color: 'currentColor' })
}

/** client-ui-layout 暴露的 layout 服务（只用得到的那个探测点） */
interface LayoutLike {
  selectPanel?: (id: string | null) => void
}

export const inject = ['slots', 'layout']

export function apply(ctx: {
  slots: {
    inject(key: string, fn: () => unknown): unknown
    register(opts: Record<string, unknown>, component: unknown): unknown
  }
  get(name: string): unknown
}): void {
  const layout = ctx.get('layout') as LayoutLike | undefined

  // ---- A. 0.1.5+：标准面板入口 ----
  if (typeof layout?.selectPanel === 'function') {
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: '插件市场' },
        (props: { size: number; active: boolean }) => createElement(MarketRailIcon, props),
      ),
    )

    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        () =>
          createElement(MarketPanel, {
            mode: 'main',
            // 回对话：main 的 `conversation` 是保留 key，selectPanel(null) 即返回
            onClose: () => layout.selectPanel?.(null),
          }),
      ),
    )
    return
  }

  // ---- B. ≤0.1.4：旧入口（与升级前行为一致） ----
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: PANEL_ID, order: 5, label: '插件市场' },
      (props: { wide: boolean }) => createElement(MarketTrigger, { wide: props.wide }),
    ),
  )

  // 面板（shell.overlay：全屏浮层，点击穿透；面板自身 opt-in pointer-events）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-market-panel', order: 10 },
      () => createElement(MarketPanel, { mode: 'overlay', onClose: () => setOpen(false) }),
    ),
  )
}
