/**
 * 面板开关单一 store —— **仅旧入口（≤0.1.4）使用**：
 * sidebar.footer.action 的入口按钮与 shell.overlay 的面板跨 slot 共享开关状态。
 *
 * 0.1.5 走标准入口（sidebar.panellist + main）时不需要它：面板挂载/卸载由 layout
 * 的选中的 key 决定，开合即 `layout.selectPanel(id | null)`。
 */
let panelOpen = false
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getOpen(): boolean {
  return panelOpen
}

export function setOpen(v: boolean): void {
  if (panelOpen === v) return
  panelOpen = v
  for (const l of listeners) l()
}

export function toggle(): void {
  setOpen(!panelOpen)
}
