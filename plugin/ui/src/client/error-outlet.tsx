/**
 * P12 崩溃"出路"：错误边界 + 出路面板。
 *
 * 原则：**崩溃必须渲染可操作的面板，永远不是空白页。**
 *
 * - `Boundary`：React 错误边界（class 组件是 React 官方唯一形式）。使用方式：
 *   每个 Tab 一个实例（key 绑定 Tab id，切 Tab 自动重置）、安装弹窗一个、
 *   面板整体再兜底一个——单点崩溃不拖累其他区域，整体崩溃仍有一张"出路卡"。
 * - `ErrorOutlet`：错误信息 + 三个动作：重试 / 复制诊断 / 复制修复提示词。
 *   诊断快照来自 Host RPC `diag:snapshot`（只读本地，见 core/src/diag.ts）；
 *   RPC 也失败时降级为仅错误信息——出路永远可用。
 *   复制走 clipboard；clipboard 不可用时把文本展开成可手选的 <pre>（webview 里禁剪贴板也能自救）。
 */
import { Component, createElement, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api.ts'
import styles from './styles.module.css'

function El(
  tag: string | ((props: any) => ReactNode),
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
): ReactNode {
  return createElement(tag as never, props ?? {}, ...children)
}

/** 错误边界：内部状态 error 非空时渲染出路面板，否则渲染 children */
export class Boundary extends Component<
  { children?: ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(`[market] ${this.props.label} 崩溃:`, error, info)
  }

  render() {
    if (this.state.error) {
      return El(ErrorOutlet, {
        error: this.state.error,
        label: this.props.label,
        onRetry: () => this.setState({ error: null }),
      })
    }
    return this.props.children
  }
}

/** 截断长文本（堆栈只留头几行，诊断信息够定位即可，不灌满剪贴板） */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…（截断）` : s
}

/** 组装诊断全文（RPC 失败时降级：仍带上客户端已知的错误与位置） */
async function buildDiagText(label: string, error: Error): Promise<string> {
  let snap = ''
  try {
    const s = await api<Record<string, unknown>>('diag:snapshot')
    snap = JSON.stringify(s, null, 2)
  } catch (e) {
    snap = `（诊断 RPC 失败：${(e as Error).message}——Host 可能已无响应）`
  }
  return [
    '【插件市场诊断】',
    `出错位置: ${label}`,
    `时间: ${new Date().toISOString()}`,
    '',
    '— 环境（Host 侧快照）—',
    snap,
    '',
    '— 错误 —',
    `${error.name}: ${error.message}`,
    error.stack ? truncate(error.stack, 1200) : '（无堆栈）',
  ].join('\n')
}

/** 修复提示词：把诊断嵌进一段可直接粘贴给 AI 的话 */
async function buildFixPrompt(label: string, error: Error): Promise<string> {
  const diag = await buildDiagText(label, error)
  return [
    '我在用 DSH（deepseek harness）的插件市场插件，面板的「' + label + '」渲染崩溃了。',
    '下面是自动导出的诊断信息。',
    '',
    '请：1) 分析最可能的原因；2) 给我一步步的修复命令——',
    '优先给不改配置就能解决的方案；涉及 dsh CLI 的请给完整命令行；',
    '如果是插件自身 bug，请说明我能用哪个临时绕过办法。',
    '',
    '====== 诊断开始 ======',
    diag,
    '====== 诊断结束 ======',
  ].join('\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 落入手动复制 */
  }
  return false
}

/** 出路面板：崩溃时渲染的可操作卡片 */
export function ErrorOutlet(props: {
  error: Error
  label: string
  onRetry: () => void
}): ReactNode {
  const { error, label, onRetry } = props
  const [copied, setCopied] = useState<'' | 'diag' | 'prompt'>('')
  const [manual, setManual] = useState<{ title: string; text: string } | null>(null)

  const copy = async (kind: 'diag' | 'prompt') => {
    const text = kind === 'diag' ? await buildDiagText(label, error) : await buildFixPrompt(label, error)
    const ok = await copyText(text)
    if (ok) {
      setCopied(kind)
      setTimeout(() => setCopied(''), 2000)
    } else {
      // 剪贴板不可用：展开全文让用户手动选择复制（出路不能依赖单一通道）
      setManual({ title: kind === 'diag' ? '诊断信息（手动全选复制）' : '修复提示词（手动全选复制）', text })
    }
  }

  return El('div', { className: styles.outlet },
    El('div', { className: styles.outletTitle }, '这里出了点问题，但不是死路'),
    El('div', { className: styles.outletMsg },
      El('code', null, truncate(`${error.name}: ${error.message}`, 200))),
    El('div', { className: styles.outletActions },
      El('button', { className: `${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`, onClick: onRetry }, '重试'),
      El('button', {
        className: `${styles.btn} ${styles.btnSm}`,
        onClick: () => void copy('diag'),
      }, copied === 'diag' ? '已复制 ✓' : '复制诊断'),
      El('button', {
        className: `${styles.btn} ${styles.btnGhost} ${styles.btnSm}`,
        onClick: () => void copy('prompt'),
      }, copied === 'prompt' ? '已复制 ✓' : '复制修复提示词'),
    ),
    manual
      ? El('div', { className: styles.outletManual },
          El('div', { className: styles.outletManualTitle }, manual.title),
          El('pre', {
            className: styles.outletManualText,
            onClick: (e: MouseEvent) => (e.target as HTMLElement).textContent && void copyText((e.target as HTMLElement).textContent || ''),
          }, manual.text),
        )
      : null,
    El('div', { className: styles.outletHint },
      '诊断只包含版本/环境与错误信息，不含对话内容与密钥。反复崩溃可到设置 Tab 检查插件更新。'),
  )
}
