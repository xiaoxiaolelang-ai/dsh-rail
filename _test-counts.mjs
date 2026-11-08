/**
 * 会话计数的结构自检：宿主的树可能有两种形状——
 *   A. 会话行是工作区行的子节点
 *   B. 组里只有表头，会话是它的兄弟节点
 * 两种都必须数对，而且嵌套组里的会话要归到内层。
 */
import fs from 'node:fs'
import assert from 'node:assert'

const source = fs.readFileSync('client.js', 'utf8')
const SHEETS = {
  '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css':
    '.wtg9ga_root{}.wtg9ga_collapsed{}.wtg9ga_logoRow{}.wtg9ga_newSession{}.wtg9ga_panelList{}.wtg9ga_panelRow{}.wtg9ga_panelTitle{}.wtg9ga_regionArea{}.wtg9ga_footArea{}.wtg9ga_footerActions{}.wtg9ga_panelActive{}',
  '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css':
    '.GAkraW_root{}.GAkraW_groupSection{}.GAkraW_flatList{}.GAkraW_workspaceDropBefore{}.GAkraW_workspaceDropAfter{}',
  '@deepseek-ai/dsh-client-ui-workspace/Rows.module.css':
    '.wnFoaW_sessionRow{}.wnFoaW_title{}.wnFoaW_selected{}.wnFoaW_projectRow{}.wnFoaW_slot{}.wnFoaW_dropBefore{}.wnFoaW_dropAfter{}',
}

function makeStore(initial) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
  }
}

class El {
  constructor(className) {
    this.className = className
    this.children = []
    this.attrs = {}
    this.style = { setProperty() {} }
    this.textContent = ''
  }
  getBoundingClientRect() { return { height: 34, width: 200 } }
  get classList() {
    const set = new Set(String(this.className).split(' ').filter(Boolean))
    return { contains: (name) => set.has(name) }
  }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k) } return this }
  get parentElement() { return this.parent ?? null }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  removeAttribute(k) { delete this.attrs[k] }
  getAttribute(k) { return this.attrs[k] ?? null }
  descendants() {
    const out = []
    const walk = (node) => { for (const kid of node.children) { out.push(kid); walk(kid) } }
    walk(this)
    return out
  }
  querySelectorAll(selector) {
    const wanted = selector.split(',').map((s) => s.trim().replace(/^\./, ''))
    return this.descendants().filter((el) => wanted.some((name) => el.classList.contains(name)))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
}

function mount(shape) {
  const root = new El('wtg9ga_root')
  if (shape === 'children') {
    const outer = new El('GAkraW_groupSection')
    const outerRow = new El('wnFoaW_projectRow')
    outer.append(outerRow, new El('wnFoaW_sessionRow'), new El('wnFoaW_sessionRow'))
    const inner = new El('GAkraW_groupSection')
    inner.append(new El('wnFoaW_projectRow'), new El('wnFoaW_sessionRow'))
    outer.append(inner)
    root.append(outer)
    return { root, expect: [2, 1] }
  }
  if (shape === 'ungrouped') {
    // 未分组：宿主给它的 key 是空串，所以行上是 "workspace:"
    const group = new El('GAkraW_groupSection')
    const row = new El('wnFoaW_projectRow')
    row.setAttribute('data-row-key', 'workspace:')
    group.append(row, new El('wnFoaW_sessionRow'), new El('wnFoaW_sessionRow'))
    root.append(group)
    return { root, expect: [2], ungrouped: group }
  }
  if (shape === 'collapsed' || shape === 'service') {
    // 折叠：组里只有表头，aria-expanded=false，一个会话行都没渲染
    const group = new El('GAkraW_groupSection')
    const row = new El('wnFoaW_projectRow')
    row.setAttribute('data-row-key', shape === 'service' ? 'workspace:exact' : 'workspace:collapsed')
    row.setAttribute('aria-expanded', 'false')
    group.append(row)
    root.append(group)
    // service 形状里服务谎报 7 条：必须被忽略，只用缓存里的 3
    return { root, expect: shape === 'service' ? [3] : [5] }
  }
  const groupA = new El('GAkraW_groupSection')
  const rowA = new El('wnFoaW_projectRow')
  groupA.append(rowA)
  const groupB = new El('GAkraW_groupSection')
  const rowB = new El('wnFoaW_projectRow')
  groupB.append(rowB)
  root.append(groupA, new El('wnFoaW_sessionRow'), new El('wnFoaW_sessionRow'), groupB, new El('wnFoaW_sessionRow'))
  return { root, expect: [2, 1] }
}

const React = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn) => fn }
globalThis.MutationObserver = class { observe() {} disconnect() {} }

for (const shape of ['children', 'siblings', 'collapsed', 'service', 'ungrouped']) {
  const store = makeStore(shape === 'collapsed'
    ? { 'dsh-rail:session-counts:v2': JSON.stringify({ 'workspace:collapsed': 5 }) }
    : shape === 'service'
      ? { 'dsh-rail:session-counts:v2': JSON.stringify({ 'workspace:exact': 3 }) }
      : {})
  // service 形状：workspaces 服务谎报 7 条（它算的是注册会话，含归档），必须被忽略
  const service = shape === 'service'
    ? {
        list: {
          getSnapshot: () => ({ items: [{ workspaceId: 'exact', title: 'E', sessionIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }] }),
          subscribe: () => () => {},
        },
      }
    : undefined
  const { root, expect } = mount(shape)
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (e) => { captured = e } },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    requestAnimationFrame: (fn) => { fn(); return 1 }, cancelAnimationFrame: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    getComputedStyle: () => ({ paddingTop: '8px' }),
    localStorage: store,
  }
  globalThis.document = {
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: { setProperty() {} } }),
    querySelector: (selector) => {
      const css = selector.match(/data-plugin-css="(.+)"\]$/)
      if (css !== null) return SHEETS[css[1]] === undefined ? null : { textContent: SHEETS[css[1]] }
      if (selector === '.wtg9ga_root') return root
      return null
    },
    addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
    documentElement: { hasAttribute: () => false }, body: {},
  }
  new Function('window', 'document', source)(globalThis.window, globalThis.document)

  const ctx = {
    get: (key) => (key === 'workspaces' ? service : undefined),
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (k) => k },
    slots: { inject: (_k, cb) => cb(), register: () => () => {} },
  }
  captured.factory((id) => { if (id === 'react') return React; throw new Error(id) }).apply(ctx)

  const rows = root.querySelectorAll('.wnFoaW_projectRow')
  const got = rows.map((r) => Number(r.getAttribute('data-dsh-rail-count')))
  assert.deepEqual(got, expect, `shape ${shape}: expected ${expect} got ${got}`)
  if (shape === 'ungrouped') {
    const group = root.querySelectorAll('.GAkraW_groupSection')[0]
    assert.equal(group.getAttribute('data-dsh-rail-ungrouped'), '', '未分组的组必须被标出来（CSS 据此隐藏）')
    console.log(`OK  ${shape} 结构：组被标为 data-dsh-rail-ungrouped`)
  }
  console.log(`OK  ${shape} 结构：计数 = ${got.join(', ')}`)
}

console.log('\ncount checks passed')
