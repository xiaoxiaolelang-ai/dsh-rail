/**
 * DSH 0.2.2-rc.2 兼容自检。
 *
 * rc.2 的面板多了一层 panelEntry，并把 panelActive 改名为 panelEntryActive，
 * 还引入"宽行"（panelEntryWide）——宿主给取消固定按钮留 38px 右侧内边距。
 * 窄栏里如果不把这层压窄、不清零那段内边距，图标就会看起来被推偏。
 *
 * 用法：node _test-rc2.mjs            → rc.2 形态
 *       RAIL_FIXTURE=legacy node _test-rc2.mjs → 旧宿主形态（回归）
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'client.js'), 'utf8')
const MODE = process.env.RAIL_FIXTURE === 'legacy' ? 'legacy' : 'rc2'

const RC2_KEYS = [
  'root', 'collapsed', 'logoRow', 'newSession', 'panelList', 'panelRow', 'panelEntry',
  'panelEntryActive', 'panelEntryWide', 'panelTitle', 'regionArea', 'footArea', 'footerActions',
]
const LEGACY_KEYS = [
  'root', 'collapsed', 'logoRow', 'newSession', 'panelList', 'panelRow', 'panelActive',
  'panelTitle', 'regionArea', 'footArea', 'footerActions',
]
const keys = MODE === 'legacy' ? LEGACY_KEYS : RC2_KEYS

const HASHLESS = {
  '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css': keys.map((k) => `.wtg9ga_${k}{}`).join(''),
  '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css':
    '.GAkraW_root{}.GAkraW_groupSection{}.GAkraW_flatList{}.GAkraW_workspaceDropBefore{}.GAkraW_workspaceDropAfter{}',
  '@deepseek-ai/dsh-client-ui-workspace/Rows.module.css':
    '.wnFoaW_sessionRow{}.wnFoaW_title{}.wnFoaW_selected{}.wnFoaW_projectRow{}.wnFoaW_slot{}.wnFoaW_dropBefore{}.wnFoaW_dropAfter{}',
}

let captured = null
const styleTags = []
globalThis.window = {
  __ModuleLoader__: { load: (entry) => { captured = entry } },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.requestAnimationFrame = (fn) => { void fn(0); return 0 }
globalThis.cancelAnimationFrame = () => {}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.document = {
  body: {},
  head: { appendChild: (tag) => styleTags.push(tag) },
  documentElement: { hasAttribute: () => false, setAttribute() {}, style: { setProperty() {} } },
  querySelector: (selector) => {
    const match = selector.match(/data-plugin-css="(.+)"\]$/)
    if (!match) return null
    const text = HASHLESS[match[1]]
    return text === undefined ? null : { textContent: text }
  },
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: { setProperty() {} } }),
  addEventListener: () => {},
  removeEventListener: () => {},
  hidden: false,
}
globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) })

const React = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useSyncExternalStore: (_sub, get) => get(),
}

const ctx = {
  effect: (factory) => {
    try {
      const dispose = factory()
      return dispose
    } catch {
      return () => {}
    }
  },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: () => {},
    register: () => () => {},
  },
  get: () => undefined,
}

new Function('window', 'document', 'require', source)(
  globalThis.window,
  globalThis.document,
  (id) => {
    if (id === 'react') return React
    throw new Error('unexpected require: ' + id)
  },
)

if (captured === null) throw new Error('module factory 未捕获')
const mod = captured.factory((id) => (id === 'react' ? React : (() => { throw new Error(id) })()))
mod.apply(ctx)

const css = styleTags.map((tag) => tag.textContent ?? '').join('\n')

if (MODE === 'rc2') {
  assert.ok(/\.wtg9ga_panelEntry \{[^}]*width: 40px !important/s.test(css), 'panelEntry 必须压到 40px')
  assert.ok(/\.wtg9ga_panelEntry \{[^}]*justify-content: center !important/s.test(css), 'panelEntry 必须居中')
  assert.ok(/\.wtg9ga_panelEntryWide \.wtg9ga_panelRow \{[^}]*padding-right: 0 !important/s.test(css), '宽行的 38px 内边距必须清零')
  assert.ok(css.includes('.wtg9ga_panelEntryActive::before'), '强调条要挂在 panelEntryActive 上')
  assert.ok(!css.includes('panelActive::before'), 'rc.2 下不该再产出旧类名规则')
  assert.ok(!css.includes('undefined'), '产出里不能有 undefined')
  console.log('OK  rc.2：panelEntry 压窄居中 + 宽行内边距清零 + 强调条挂 panelEntryActive')
} else {
  assert.ok(css.includes('.wtg9ga_panelActive::before'), '旧宿主的强调条必须保留')
  assert.ok(!css.includes('panelEntry'), '旧宿主不该出现 panelEntry 规则')
  assert.ok(!css.includes('undefined'), '产出里不能有 undefined')
  console.log('OK  legacy：panelActive 强调条仍在，且不引入 panelEntry 规则')
}
