/**
 * #228 · 子代理服务多版本垫片
 *
 * DSH 子代理 API 已历经三个世代，0.4.11 按 alpha.1 编译因此在 alpha.2 上全灭
 * （`subagents.start is not a function`）；0.2.2-rc.2 又删掉了 `subagents.list()`、
 * 并把 startActivation 的 spec 从嵌套改成扁平（#378，`subagents.list is not a function`
 * + `spec.parent undefined` → TypeError）：
 *
 * |          | alpha.1                                      | alpha.2（嵌套 spec）                        | 0.2.2-rc.2+（扁平 spec）                     |
 * |----------|----------------------------------------------|---------------------------------------------|----------------------------------------------|
 * | provider | 不需要（start(name, …)）                     | 需先 subagents.list() 拿 provider 名        | **list() 已删除**，getProvider(name) 探测    |
 * | 启动     | start(name, {label, prompt, parent, signal}) | startActivation({provider, label, request:{prompt, parent}, signal, delivery}) | startActivation({provider, label, prompt, parent, signal, delivery}) |
 * | 返回     | {id \| sessionId}                            | {childId}                                   | {childId, runId, …}（无 sessionId）          |
 * | 结果投递 | 隐式                                         | 必须显式 delivery: 'caller' \| 'parent'     | 同左                                         |
 * | abort    | signal 可带走子代理                          | 只在初始消息被收件箱接受前有效；之后须 interrupt | 同左（interrupt 第一参即 childId）           |
 *
 * 垫片原则：**按能力探测（typeof）多版本兼容，绝不按版本号分支**——npm 上
 * @deepseek-ai/dsh-subagent 发布的是 0.0.1-rc.1，实机版本号完全不可靠（#378）。
 * host 侧拿到统一的 { sessionId, childId } 视图；取消路径经 interruptSubagent 真正停掉子代理。
 */

/** 统一的启动结果：sessionId 供会话轮询/审查监控；childId 供 interrupt 用（仅新 API 返回） */
export interface SubagentHandle {
  sessionId: string | null
  childId: string | null
}

type PromptPart = Array<{ type: string; text: string }>

/** 子代理服务形状：各世代字段按存在性探测，绝无必选成员 */
export interface SubagentsService {
  list?(): string[]
  getProvider?(name: string): unknown
  start(
    name: string,
    request: {
      label?: string
      prompt: PromptPart
      parent: unknown
      signal: AbortSignal
    },
  ): Promise<{ sessionId?: string; id?: string }>
  startActivation?(spec: {
    provider: string
    label?: string
    /** alpha.2 嵌套形态 */
    request?: { prompt: PromptPart; parent: unknown }
    /** 0.2.2-rc.2+ 扁平形态 */
    prompt?: PromptPart
    parent?: unknown
    signal?: AbortSignal
    delivery?: 'caller' | 'parent'
  }): Promise<{ childId?: string; sessionId?: string; id?: string }>
  interrupt?(
    id: string,
    opts: { kind: 'ancestor'; agent: unknown } | { kind: 'user'; parentSessionId?: string },
  ): Promise<unknown>
}

/** getProvider 能力探测的候选序：spawn 优先（DSH 内置零依赖路径） */
const PROVIDER_CANDIDATES = ['spawn', 'fork', 'claude-code', 'codex', 'acp'] as const

/**
 * #378 · provider 选择改为能力探测：0.2.2-rc.2 删除了 subagents.list()（且 npm 上
 * @deepseek-ai/dsh-subagent 发布的 0.0.1-rc.1 与实机版本完全脱节，按版本号分支不可行）。
 * 探测序：list() 可用且有结果 → 用之（老宿主原语义）；getProvider 可用 → 按候选序探测
 * 第一个真实存在的 provider；都不可用 → 'spawn' 兜底（startActivation 时宿主自己也会校验）。
 */
export function pickSubagentProvider(subagents: SubagentsService): string {
  const anySub = subagents as unknown as Partial<SubagentsService> & Record<string, unknown>
  try {
    if (typeof anySub.list === 'function') {
      const names = anySub.list()
      if (Array.isArray(names) && names.length > 0) {
        return names.includes('spawn') ? 'spawn' : String(names[0])
      }
    }
  } catch {
    /* list 存在但抛错（半兼容形态）：继续探测 getProvider */
  }
  if (typeof anySub.getProvider === 'function') {
    for (const candidate of PROVIDER_CANDIDATES) {
      try {
        if (anySub.getProvider(candidate)) return candidate
      } catch {
        /* 该候选探测失败：试下一个 */
      }
    }
  }
  return 'spawn'
}

/** 启动一个子代理：宿主有 startActivation（alpha.2+）走新 API（扁平 spec 先试、嵌套回退），否则回退旧 start */
export async function startSubagent(
  subagents: SubagentsService,
  provider: string,
  opts: {
    label: string
    prompt: PromptPart
    parent: unknown
    signal: AbortSignal
  },
): Promise<SubagentHandle> {
  const anySub = subagents as unknown as Partial<SubagentsService> & Record<string, unknown>
  if (typeof anySub.startActivation === 'function') {
    let run: { childId?: string; sessionId?: string; id?: string }
    try {
      // 0.2.2-rc.2+ 扁平形态：prompt / parent 在 spec 顶层（#378 报告者核对过
      // @deepseek-ai/dsh-tool-subagent 同版宿主的调用点）
      run = (await anySub.startActivation({
        provider,
        label: opts.label,
        prompt: opts.prompt,
        parent: opts.parent,
        signal: opts.signal,
        // alpha.2 起结果投递必须显式：安装/审查的 verdict 由本侧轮询子会话获取，'caller' 才带回执
        delivery: 'caller',
      })) as { childId?: string; sessionId?: string; id?: string }
    } catch (flatError) {
      // alpha.2 嵌套形态：prompt / parent 包在 request 里——扁平失败再试嵌套，
      // 全失败抛**原始扁平错误**（避免回退错误掩盖真因）
      try {
        run = (await anySub.startActivation({
          provider,
          label: opts.label,
          request: { prompt: opts.prompt, parent: opts.parent },
          signal: opts.signal,
          delivery: 'caller',
        })) as { childId?: string; sessionId?: string; id?: string }
      } catch {
        throw flatError
      }
    }
    const childId = run.childId ?? null
    // 0.2.2-rc.2 的返回无 sessionId——childId 即持久化子会话 id（manager.startLocalNamed
    // 中 childId = spec.childId ?? randomUUID()），sessionQuery.readSession(childId) 可直接轮询
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
 * alpha.2+ 下真正终止一个已启动的子代理：优先 interrupt(childId, {kind:'ancestor', agent})，
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
