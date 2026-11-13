/**
 * #228 · 子代理双版本垫片回归测试（零依赖，直接跑构建产物 lib/subagent-compat.js）
 *
 * 验证三件事：
 *   alpha.1 宿主（只有 start）→ startSubagent 走 start(name, request)，sessionId 取 id
 *   alpha.2 宿主（startActivation + interrupt）→ 走 startActivation(spec)，spec 含
 *     provider/label/request:{prompt,parent}/signal/delivery:'caller'，sessionId 取 childId
 *   取消路径 → interrupt(childId, {kind:'ancestor', agent}) 优先、
 *     {kind:'user', parentSessionId} 兜底、interrupt 不存在/childId 缺失安全降级 false
 *
 * 用法：node test/subagent-compat.mjs（plugin/ui 下 npm test 已接）
 */
import assert from 'node:assert/strict'
import { startSubagent, interruptSubagent, pickSubagentProvider } from '../lib/subagent-compat.js'

const PROMPT = [{ type: 'text', text: 'hi' }]
const SIGNAL = AbortSignal.timeout(1000)
const OPTS = { label: 'L', prompt: PROMPT, parent: { sessionId: 'root-1' }, signal: SIGNAL }

// ---------- 1. alpha.1：只有 start ----------
{
  const calls = []
  const subagents = {
    list: () => ['spawn'],
    start: async (name, request) => {
      calls.push({ name, request })
      return { id: 'child-old' }
    },
  }
  const h = await startSubagent(subagents, 'spawn', OPTS)
  assert.equal(calls.length, 1, 'alpha.1 必须走 start')
  assert.equal(calls[0].name, 'spawn')
  assert.equal(calls[0].request.label, 'L')
  assert.equal(calls[0].request.parent.sessionId, 'root-1')
  assert.equal(h.sessionId, 'child-old', 'alpha.1 sessionId 取 id')
  assert.equal(h.childId, null, 'alpha.1 无 childId（旧宿主 abort 即可终止）')
  // 旧宿主 interrupt 不存在 → 降级 false
  assert.equal(await interruptSubagent(subagents, { childId: 'x', agent: {} }), false)
}

// ---------- 2. alpha.2：startActivation（嵌套形态宿主；扁平 spec 会被宿主拒绝） ----------
{
  const specs = []
  const subagents = {
    list: () => ['spawn', 'other'],
    startActivation: async (spec) => {
      specs.push(spec)
      // 真实 alpha.2 宿主读 spec.request.prompt —— 收到扁平 spec 会炸（#378 报告者核对的形态）
      if (!spec.request) throw new TypeError("Cannot read properties of undefined (reading 'prompt')")
      return { childId: 'child-new' }
    },
  }
  const h = await startSubagent(subagents, 'spawn', OPTS)
  assert.equal(specs.length, 2, '扁平先试失败 → 回退嵌套，共两次调用')
  assert.equal(specs[1].provider, 'spawn')
  assert.equal(specs[1].label, 'L')
  assert.deepEqual(specs[1].request.prompt, PROMPT)
  assert.equal(specs[1].request.parent.sessionId, 'root-1')
  assert.equal(specs[1].signal, SIGNAL)
  assert.equal(specs[1].delivery, 'caller', '结果投递必须显式 caller')
  assert.equal(h.childId, 'child-new')
  assert.equal(h.sessionId, 'child-new', 'alpha.2 sessionId 回退取 childId')
}

// ---------- 3. alpha.2 interrupt：ancestor 优先 ----------
{
  const calls = []
  const subagents = {
    list: () => ['spawn'],
    interrupt: async (id, opts) => {
      calls.push({ id, opts })
      return { ok: true }
    },
  }
  const ok = await interruptSubagent(subagents, { childId: 'child-1', agent: { sessionId: 'root-9' } })
  assert.equal(ok, true, 'interrupt 成功应返回 true')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'child-1')
  assert.equal(calls[0].opts.kind, 'ancestor')
  assert.equal(calls[0].opts.agent.sessionId, 'root-9')
}

// ---------- 4. interrupt ancestor 抛错 → 降级 user 兜底 ----------
{
  const calls = []
  const subagents = {
    list: () => ['spawn'],
    interrupt: async (id, opts) => {
      calls.push(opts)
      if (opts.kind === 'ancestor') throw new Error('no ancestor perm')
      return { ok: true }
    },
  }
  const ok = await interruptSubagent(subagents, { childId: 'child-1', agent: { sessionId: 'root-9' } })
  assert.equal(ok, true, 'ancestor 失败应降级 user 兜底')
  assert.deepEqual(calls.map((c) => c.kind), ['ancestor', 'user'])
  assert.equal(calls[1].parentSessionId, 'root-9')
}

// ---------- 5. interrupt 全失败 / 不存在 / childId 缺失 → 安全降级 false ----------
{
  const subagents = {
    list: () => ['spawn'],
    interrupt: async () => {
      throw new Error('always fail')
    },
  }
  assert.equal(await interruptSubagent(subagents, { childId: 'x', agent: {} }), false, 'agent 无 sessionId 且 ancestor 失败 → false')
  assert.equal(await interruptSubagent(undefined, { childId: 'x', agent: {} }), false, '服务缺失 → false')
  assert.equal(await interruptSubagent(subagents, { childId: null, agent: {} }), false, 'childId 缺失 → false（不调 interrupt）')
}

// ---------- 6. #378 · 0.2.2-rc.2：无 list()，扁平 spec 先试成功 ----------
{
  const specs = []
  const subagents = {
    getProvider: (name) => (name === 'spawn' ? { name } : null),
    startActivation: async (spec) => {
      specs.push(spec)
      return { childId: 'child-flat', runId: 'run-1' }
    },
  }
  // provider 选择：list 不存在 → getProvider 探测命中 spawn
  assert.equal(pickSubagentProvider(subagents), 'spawn', 'getProvider 探测应命中 spawn')
  const h = await startSubagent(subagents, 'spawn', OPTS)
  assert.equal(specs.length, 1, '扁平 spec 一次成功，不得再试嵌套')
  assert.equal(specs[0].prompt, PROMPT, '0.2.2-rc.2 扁平形态：prompt 在 spec 顶层')
  assert.equal(specs[0].parent.sessionId, 'root-1', '扁平形态：parent 在 spec 顶层')
  assert.equal(specs[0].request, undefined, '扁平形态：不得带 request 包裹')
  assert.equal(specs[0].delivery, 'caller')
  assert.equal(h.childId, 'child-flat')
  assert.equal(h.sessionId, 'child-flat', '0.2.2-rc.2 返回无 sessionId → 取 childId（即持久化子会话 id）')
}

// ---------- 7. #378 · alpha.2 嵌套宿主：扁平失败 → 回退嵌套，抛原始错误 ----------
{
  const specs = []
  const subagents = {
    list: () => ['spawn'],
    startActivation: async (spec) => {
      specs.push(spec)
      if (!spec.request) throw new TypeError("Cannot read properties of undefined (reading 'id')")
      return { childId: 'child-nested' }
    },
  }
  const h = await startSubagent(subagents, 'spawn', OPTS)
  assert.equal(specs.length, 2, '扁平失败后应回退嵌套')
  assert.equal(specs[0].request, undefined, '第一次尝试是扁平形态')
  assert.deepEqual(specs[1].request.prompt, PROMPT, '第二次尝试是嵌套形态')
  assert.equal(h.sessionId, 'child-nested')
}

// ---------- 8. #378 · 两形态全失败 → 抛原始扁平错误（不掩盖真因） ----------
{
  const subagents = {
    getProvider: () => null,
    startActivation: async () => {
      throw new Error('host rejected')
    },
  }
  try {
    await startSubagent(subagents, 'spawn', OPTS)
    assert.fail('两形态全失败必须抛错')
  } catch (e) {
    assert.equal(e.message, 'host rejected', '抛的是原始扁平错误')
  }
  // provider 选择：list/getProvider 都不可用 → 'spawn' 兜底
  assert.equal(pickSubagentProvider({ start: async () => ({}) }), 'spawn', '无探测手段 → spawn 兜底')
  // getProvider 抛错 → 继续兜底，不炸
  assert.equal(
    pickSubagentProvider({ getProvider: () => { throw new Error('boom') } }),
    'spawn',
    'getProvider 抛错安全兜底',
  )
}

console.log('subagent-compat: 8/8 全部通过')
