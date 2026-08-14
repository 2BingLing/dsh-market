/**
 * @dsh-market/plugin client half：
 *  - sidebar.footer.action 注册「插件市场」入口按钮
 *  - shell.overlay 注册市场面板（4-tab：推荐/搜索/已装/设置）
 * 面板开关状态统一走 store.ts（跨 slot 共享）。
 */
import { createElement, useSyncExternalStore } from 'react'
import { MarketPanel } from './panel.tsx'
import { getOpen, setOpen, subscribe, toggle } from './store.ts'
import styles from './styles.module.css'

/** 入口按钮：侧边栏底部「设置」旁的图标按钮 */
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
      { className: styles.triggerIcon, 'aria-hidden': true },
      '🧩',
    ),
    props.wide ? createElement('span', { className: styles.triggerLabel }, '插件市场') : null,
  )
}

export const inject = ['slots']

export function apply(ctx: {
  slots: {
    inject(key: string, fn: () => unknown): unknown
    register(opts: Record<string, unknown>, component: unknown): unknown
  }
}): void {
  // 面板触发器
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-market', order: 5, label: '插件市场' },
      (props: { wide: boolean }) => createElement(MarketTrigger, { wide: props.wide }),
    ),
  )

  // 面板（shell.overlay：全屏浮层，点击穿透；面板自身 opt-in pointer-events）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-market-panel', order: 10 },
      () => createElement(MarketPanel, { onClose: () => setOpen(false) }),
    ),
  )
}
