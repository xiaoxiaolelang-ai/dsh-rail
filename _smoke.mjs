/**
 * 一次性冒烟检查（不属于插件本体）：
 * 用假的 window/document/ctx 跑一遍 client.js 的 apply，
 * 把最终注入的样式表打印出来，确认模板没产出 undefined、选择器都成形。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'client.js'), 'utf8')

const HASHLESS = {
  '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css': [
    'root', 'collapsed', 'logoRow', 'newSession', 'panelList', 'panelRow', 'panelActive', 'panelTitle',
    'regionArea', 'footArea', 'footerActions',
  ].map((key) => `.wtg9ga_${key}{}`).join(''),
  '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css': '.GAkraW_root{}.GAkraW_groupSection{}.GAkraW_flatList{}.GAkraW_workspaceDropBefore{}.GAkraW_workspaceDropAfter{}',
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
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.document = {
  body: {},
  head: { appendChild: (tag) => styleTags.push(tag) },
  documentElement: { hasAttribute: () => false },
  querySelector: (selector) => {
    const match = selector.match(/data-plugin-css="(.+)"\]$/)
    if (!match) return null
    const text = HASHLESS[match[1]]
    return text === undefined ? null : { textContent: text }
  },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  hidden: false,
}

const React = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}

const disposers = []
const registrations = []
const ctx = {
  effect: (factory) => {
    const dispose = factory()
    disposers.push(dispose)
    return dispose
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  slots: {
    inject: (key, callback) => { registrations.push({ key, callback }) },
    register: (options) => { registrations.push(options); return () => {} },
  },
}

// eslint-disable-next-line no-new-func
new Function('window', 'document', 'require', source)(
  globalThis.window,
  globalThis.document,
  (id) => {
    if (id === 'react') return React
    throw new Error('unexpected require: ' + id)
  },
)

if (captured === null) throw new Error('module factory was not captured')
const mod = captured.factory((id) => (id === 'react' ? React : (() => { throw new Error(id) })()))
mod.apply(ctx)

const css = styleTags.map((tag) => tag.textContent).join('\n')

const checks = [
  ['.wtg9ga_root', 'sidebar root grid'],
  ['grid-template-columns: 40px minmax(0, 1fr)', 'two-column grid'],
  ['.wtg9ga_panelList', 'icon rail'],
  ['.wtg9ga_footArea', 'footer spans both columns'],
  ['--dsh-session-list-edge-inset', 'scrollbar inset'],
  ['.wnFoaW_sessionRow', 'session row hierarchy'],
  ['.wnFoaW_selected', 'selected row'],
  ['.GAkraW_groupSection + .GAkraW_groupSection', 'workspace divider'],
  ['.wnFoaW_projectRow {\n  position: relative;\n  font-weight: 500;', 'workspace header stays static'],
  ['var(--dsh-workspace-indent, 0px)', 'group guide line'],
  ['top: var(--dsh-rail-guide-top);', 'guide top comes from measurement only'],
  ['.GAkraW_groupSection {\n  padding-top: 8px', 'uniform group padding'],
  ['border-radius: 999px', 'rounded separators'],
  ['var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe)) 26%', 'workspace band tinted and thinned'],
  ['label-primary, #1a1a1a) 9%', 'session hairline neutral and fainter'],
  ['.wnFoaW_sessionRow:not(.wnFoaW_dropAfter)::after', 'session separator'],
  ['state-business-primary', 'selected session accent'],
  ['.wtg9ga_panelActive::before', 'rail active bar'],
  ['[data-dsh-rail-balance-dot]', 'balance status dot'],
  ['.wnFoaW_projectRow[data-dsh-rail-count]::after', 'session count badge'],
  ['content: attr(data-dsh-rail-count)', 'count rendered from attribute'],
  ["[data-dsh-rail-balance-delta][data-tone='down']", 'spend delta styled'],
  ['dsw-focus-ring-color', 'focus accent bar'],
  ['[data-dsh-rail-balance]', 'balance chip'],
  ['flex: 0 0 100%', 'chip takes a full row'],
]
for (const [needle, label] of checks) {
  console.log((css.includes(needle) ? 'OK   ' : 'FAIL ') + label)
}
for (const bad of ['undefined', 'null}', 'NaN']) {
  if (css.includes(bad)) console.log('FAIL  output contains ' + bad)
}
console.log((css.includes('.GAkraW_flatList} > * + *') ? 'FAIL ' : 'OK   ') + 'flat view keeps native spacing')
console.log((css.includes('--dsh-rail-head') ? 'FAIL ' : 'OK   ') + 'no leftover head variable in css')
console.log((/top:\s*calc\(var\(--dsh-rail-guide-top/.test(css) ? 'FAIL ' : 'OK   ') + 'guide top has no css arithmetic')
console.log((css.includes('--dsh-rail-guide-top,') ? 'FAIL ' : 'OK   ') + 'guide top has no literal fallback')
console.log('registrations:', JSON.stringify(registrations.map((r) => r.id ?? r.key)))
console.log('style tags:', styleTags.length, 'chars:', css.length)
console.log('---- css ----')
console.log(css)
