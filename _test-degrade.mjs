/**
 * 退化路径自检：宿主不再提供拖拽指示器类名时，结构层必须仍然存在，
 * 只是不加 :not 守卫——不能整层消失。
 */
import fs from 'node:fs'
import assert from 'node:assert'

const source = fs.readFileSync('client.js', 'utf8')
const SHEETS = {
  '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css':
    '.wtg9ga_root{}.wtg9ga_collapsed{}.wtg9ga_logoRow{}.wtg9ga_newSession{}.wtg9ga_panelList{}.wtg9ga_panelRow{}.wtg9ga_panelTitle{}.wtg9ga_regionArea{}.wtg9ga_footArea{}.wtg9ga_footerActions{}',
  // 注意：这里故意不给 workspaceDropBefore / workspaceDropAfter
  '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css':
    '.GAkraW_root{}.GAkraW_groupSection{}.GAkraW_flatList{}',
  // 同样不给 dropBefore / dropAfter
  '@deepseek-ai/dsh-client-ui-workspace/Rows.module.css':
    '.wnFoaW_sessionRow{}.wnFoaW_title{}.wnFoaW_selected{}.wnFoaW_projectRow{}.wnFoaW_slot{}',
}

const React = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}
let captured = null
const tags = []
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = { __ModuleLoader__: { load: (e) => { captured = e } }, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.document = {
  head: { appendChild: (t) => tags.push(t) },
  querySelector: (sel) => {
    const m = sel.match(/data-plugin-css="(.+)"\]$/)
    if (!m) return null
    return SHEETS[m[1]] === undefined ? null : { textContent: SHEETS[m[1]] }
  },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
  documentElement: { hasAttribute: () => false },
  body: {},
}
new Function('window', 'document', source)(globalThis.window, globalThis.document)

const components = {}
const ctx = {
  get: () => undefined,
  effect: (fn) => fn(),
  locale: { register: () => () => {}, bind: () => (k) => k },
  slots: { inject: (_k, cb) => cb(), register: (o, c) => { components[o.id ?? o.name ?? o.key] = c; return () => {} } },
}
captured.factory((id) => { if (id === 'react') return React; throw new Error(id) }).apply(ctx)

const css = tags.map((t) => t.textContent).join('\n')
assert.ok(css.length > 1000, 'css emitted')
assert.ok(css.includes('.GAkraW_groupSection + .GAkraW_groupSection::after'), '组间隔离带仍在（无守卫形态）')
assert.ok(css.includes('.wnFoaW_sessionRow::after'), '会话隔离带仍在（无守卫形态）')
assert.ok(css.includes('.wnFoaW_sessionRow.wnFoaW_selected::before'), '选中强调条仍在（无守卫形态）')
assert.ok(!css.includes('workspaceDropBefore'), '没有凭空编出守卫类名')
assert.ok(!css.includes('dropBefore'), '没有凭空编出守卫类名')
console.log('OK  退化路径：拖拽类名缺失时结构层仍完整（无 :not 守卫）')
console.log('OK  未凭空引用未知类名')
console.log('\ndegrade checks passed')
