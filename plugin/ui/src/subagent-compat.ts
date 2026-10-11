/**
 * #228 · 子代理服务双版本垫片
 *
 * DSH 0.2.1-alpha.2 重构了 subagents 服务，0.4.11 按 alpha.1 编译因此在 alpha.2 上
 * 全灭（安全模式安装必走 T1，`subagents.start is not a function` 直接炸）：
 *
 * |          | alpha.1                                | alpha.2                                   |
 * |----------|----------------------------------------|-------------------------------------------|
 * | 启动     | start(name, {label, prompt, parent, signal}) | startActivation({provider, label, request:{prompt, parent}, signal, delivery}) |
 * | 返回     | {id \| sessionId}                      | {childId}                                 |
 * | 结果投递 | 隐式                                   | 必须显式 delivery: 'caller' \| 'parent'   |
 * | abort    | signal 可带走子代理                    | 只在初始消息被收件箱接受前有效；之后子代理常驻，须显式 interrupt |
 *
 * 垫片原则：**按能力探测（typeof）双兼容**，不猜宿主版本号——alpha.3 再改也有兜底路径。
 * host 侧拿到统一的 { sessionId, childId } 视图；取消路径经 interruptSubagent 真正停掉子代理。
 */

/** 统一的启动结果：sessionId 供会话轮询/审查监控；childId 供 interrupt 用（仅新 API 返回） */
export interface SubagentHandle {
  sessionId: string | null
  childId: string | null
}

/** 子代理服务形状：alpha.1 的 start 必有；alpha.2 的 startActivation / interrupt 按存在性探测 */
export interface SubagentsService {
  list(): string[]
  start(
    name: string,
    request: {
      label?: string
      prompt: Array<{ type: string; text: string }>
      parent: unknown
      signal: AbortSignal
    },
  ): Promise<{ sessionId?: string; id?: string }>
  startActivation?(spec: {
    provider: string
    label?: string
    request: { prompt: Array<{ type: string; text: string }>; parent: unknown }
    signal?: AbortSignal
    delivery?: 'caller' | 'parent'
  }): Promise<{ childId?: string; sessionId?: string; id?: string }>
  interrupt?(
    id: string,
    opts: { kind: 'ancestor'; agent: unknown } | { kind: 'user'; parentSessionId?: string },
  ): Promise<unknown>
}

/** 启动一个子代理：宿主有 startActivation（alpha.2+）走新 API，否则回退旧 start */
export async function startSubagent(
  subagents: SubagentsService,
  provider: string,
  opts: {
    label: string
    prompt: Array<{ type: string; text: string }>
    parent: unknown
    signal: AbortSignal
  },
): Promise<SubagentHandle> {
  const anySub = subagents as unknown as Partial<SubagentsService> & Record<string, unknown>
  if (typeof anySub.startActivation === 'function') {
    const run = (await anySub.startActivation({
      provider,
      label: opts.label,
      request: { prompt: opts.prompt, parent: opts.parent },
      signal: opts.signal,
      // alpha.2 起结果投递必须显式：安装/审查的 verdict 由本侧轮询子会话获取，'caller' 才带回执
      delivery: 'caller',
    })) as { childId?: string; sessionId?: string; id?: string }
    const childId = run.childId ?? null
    const sessionId = run.sessionId ?? run.id ?? childId
    return { sessionId, childId }
  }
  const run = await subagents.start(provider, {
    label: opts.label,
    prompt: opts.prompt,
    parent: opts.parent,
    signal: opts.signal,
  })
  return { sessionId: run.sessionId ?? run.id ?? null, childId: null }
}

/**
 * alpha.2 下真正终止一个已启动的子代理：优先 interrupt(childId, {kind:'ancestor', agent})，
 * 失败降级 {kind:'user', parentSessionId}（#228 报告者验证的调用形态）。
 * interrupt 不存在（旧宿主）或 childId 缺失时返回 false——旧宿主 abort 信号本就能带走
 * 子代理，降级为「仅 abort」是安全的，绝不因终止逻辑自身抛错而让取消流程失败。
 */
export async function interruptSubagent(
  subagents: SubagentsService | undefined | null,
  child: { childId: string | null; agent: unknown },
): Promise<boolean> {
  if (!child.childId) return false
  const anySub = subagents as unknown as Partial<SubagentsService> | null | undefined
  if (!anySub || typeof anySub.interrupt !== 'function') return false
  try {
    await anySub.interrupt(child.childId, { kind: 'ancestor', agent: child.agent })
    return true
  } catch {
    const parentSessionId = (child.agent as { sessionId?: string } | undefined)?.sessionId
    if (!parentSessionId) return false
    try {
      await anySub.interrupt(child.childId, { kind: 'user', parentSessionId })
      return true
    } catch {
      return false
    }
  }
}
