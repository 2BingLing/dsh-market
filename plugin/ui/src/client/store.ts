/**
 * 面板开关单一 store：sidebar 入口按钮与 shell.overlay 面板跨 slot 共享。
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
