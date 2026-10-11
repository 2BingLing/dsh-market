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
import { startSubagent, interruptSubagent } from '../lib/subagent-compat.js'

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

// ---------- 2. alpha.2：startActivation ----------
{
  const specs = []
  const subagents = {
    list: () => ['spawn', 'other'],
    startActivation: async (spec) => {
      specs.push(spec)
      return { childId: 'child-new' }
    },
  }
  const h = await startSubagent(subagents, 'spawn', OPTS)
  assert.equal(specs.length, 1, 'alpha.2 必须走 startActivation')
  assert.equal(specs[0].provider, 'spawn')
  assert.equal(specs[0].label, 'L')
  assert.deepEqual(specs[0].request.prompt, PROMPT)
  assert.equal(specs[0].request.parent.sessionId, 'root-1')
  assert.equal(specs[0].signal, SIGNAL)
  assert.equal(specs[0].delivery, 'caller', '结果投递必须显式 caller')
  assert.equal(h.childId, 'child-new')
  assert.equal(h.sessionId, 'child-new', 'alpha.2 sessionId 回退取 childId')
  // 旧 start 不得被调用（宿主上不存在则无所谓，但 fake 里没定义，调了会 TypeError）
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

console.log('subagent-compat: 5/5 全部通过')
