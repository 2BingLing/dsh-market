/**
 * 双路注册回归测试（零依赖，直接跑构建产物 lib/client.js）
 *
 * 为什么需要它：client half 无法单测 React 渲染，但**注册路径**完全可以离线验证——
 * bundle 本身只是个 `window.__ModuleLoader__.load({id, factory})` 调用，喂一个假
 * require 把 factory 取出来，再用两代宿主的假 ctx 分别 apply，即可断言：
 *   0.1.5+（layout 有 selectPanel）→ 注册 sidebar.panellist + main，且 id === key
 *   ≤0.1.4（layout 无 selectPanel）→ 注册 sidebar.footer.action + shell.overlay
 * 两条路径互斥，且各自的 slot 名/选项符合官方契约。改坏任何一条都会在这里红。
 *
 * 用法：node test/client-dual-path.mjs   （plugin/ui 下 npm test 已接）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')

// ---------- 1. 取出 factory ----------
let factory = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory: f }) => {
      assert.equal(id, '@dsh-market/plugin', 'bundle 注册的 id 必须是包名')
      factory = f
    },
  },
}

const code = readFileSync(bundlePath, 'utf8')
// 去掉 sourceMappingURL 注释后按脚本执行（顶层就是那次 load 调用）
new Function(code.replace(/\/\/# sourceMappingURL=.*$/m, ''))()

assert.ok(typeof factory === 'function', 'bundle 未注册 factory')

// ---------- 2. 假 react（只用到 createElement / useSyncExternalStore） ----------
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useSyncExternalStore: (_sub, getSnapshot) => getSnapshot(),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
}
const fakeRequire = (id) => {
  if (id === 'react') return reactStub
  throw new Error(`bundle 要求了未预期的外部模块: ${id}（构建 external 清单可能不对）`)
}

const mod = factory(fakeRequire)
assert.ok(typeof mod.apply === 'function', 'client half 未导出 apply')

// ---------- 3. 假宿主 ctx ----------
function makeCtx(layout) {
  const injected = []
  const registrations = []
  return {
    injected,
    registrations,
    ctx: {
      get: (name) => (name === 'layout' ? layout : undefined),
      slots: {
        inject: (key, fn) => {
          injected.push(key)
          fn() // 模拟该 slot 出现，触发注册
        },
        register: (opts, comp) => {
          registrations.push({ opts, comp })
          return () => {}
        },
      },
    },
  }
}

const byName = (regs, name) => regs.filter((r) => r.opts.name === name)

// ---------- 4. 新版路径（0.1.5+：layout.selectPanel 存在） ----------
{
  const { ctx, injected, registrations } = makeCtx({
    selectPanel: () => {},
    toggleSidebar: () => {},
  })
  mod.apply(ctx)

  assert.deepEqual(
    injected,
    ['sidebar.panellist', 'main'],
    '0.1.5 必须且只能注册 panellist + main',
  )

  const rail = byName(registrations, 'sidebar.panellist')
  const main = byName(registrations, 'main')
  assert.equal(rail.length, 1, 'sidebar.panellist 应恰好注册 1 项')
  assert.equal(main.length, 1, 'main 应恰好注册 1 项')

  // 契约硬约束：panellist.id 必须等于 main.key，否则点击 nav 时
  // layout.selectPanel(id) 会因反查不到 main 条目而抛错
  assert.equal(
    rail[0].opts.id,
    main[0].opts.key,
    'panellist.id 必须与 main.key 同名（否则 layout.selectPanel 抛错）',
  )
  assert.equal(rail[0].opts.id, 'dsh-market')
  assert.equal(typeof rail[0].opts.label, 'string', 'panellist 需要 label')
  assert.equal(typeof rail[0].opts.order, 'number', 'panellist 需要 order')

  // 旧 slot 不得在新版路径下残留（否则界面上会出现重复入口）
  assert.equal(byName(registrations, 'sidebar.footer.action').length, 0, '新版不应注册 footer.action')
  assert.equal(byName(registrations, 'shell.overlay').length, 0, '新版不应注册 shell.overlay')

  console.log('✓ 0.1.5+ 路径：sidebar.panellist + main（id === key === "dsh-market"）')
}

// ---------- 5. 旧版路径（≤0.1.4：layout 只有 openDetails/closeDetails） ----------
{
  const { ctx, injected, registrations } = makeCtx({
    toggleSidebar: () => {},
    openDetails: () => {},
    closeDetails: () => {},
  })
  mod.apply(ctx)

  assert.deepEqual(
    injected,
    ['sidebar.footer.action', 'shell.overlay'],
    '≤0.1.4 必须且只能注册 footer.action + overlay',
  )

  const trigger = byName(registrations, 'sidebar.footer.action')
  const overlay = byName(registrations, 'shell.overlay')
  assert.equal(trigger.length, 1)
  assert.equal(overlay.length, 1)
  assert.equal(trigger[0].opts.id, 'dsh-market')
  assert.equal(overlay[0].opts.id, 'dsh-market-panel')

  assert.equal(byName(registrations, 'main').length, 0, '旧版不应注册 main（该 slot 不存在）')
  assert.equal(byName(registrations, 'sidebar.panellist').length, 0, '旧版不应注册 panellist')

  console.log('✓ ≤0.1.4 路径：sidebar.footer.action + shell.overlay')
}

// ---------- 6. layout 服务缺失（极端降级）不应崩 ----------
{
  const { ctx, injected } = makeCtx(undefined)
  mod.apply(ctx)
  assert.deepEqual(injected, ['sidebar.footer.action', 'shell.overlay'], 'layout 缺失时降级到旧路径')
  console.log('✓ layout 缺失：安全降级到旧入口（不抛错）')
}

// ---------- 7. inject 声明 ----------
assert.deepEqual(mod.inject, ['slots', 'layout'], 'inject 必须声明 slots + layout')
console.log('✓ inject 声明：["slots", "layout"]')

console.log('\n全部通过：双路注册符合两代 DSH 契约。')
