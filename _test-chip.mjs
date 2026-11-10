/**
 * 余额条的渲染自检。
 *
 * 为什么需要它：_smoke.mjs 只检查"生成的 CSS 里有这行字符串"，从不渲染组件。
 * 0.2.2 就因为这个盲区出了事故——`topUpUrl` 在声明之前被使用（TDZ），组件一渲染
 * 就抛错，整个余额条消失，而所有断言依然是绿的。
 */
import fs from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(join(here, 'client.js'), 'utf8')

const SHEETS = {
  '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css':
    '.wtg9ga_root{}.wtg9ga_panelActive{}.wtg9ga_panelList{}.wtg9ga_panelRow{}.wtg9ga_panelTitle{}.wtg9ga_footerActions{}.wtg9ga_footArea{}.wtg9ga_regionArea{}.wtg9ga_collapsed{}.wtg9ga_logoRow{}.wtg9ga_newSession{}',
  '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css':
    '.GAkraW_root{}.GAkraW_groupSection{}.GAkraW_flatList{}.GAkraW_workspaceDropBefore{}.GAkraW_workspaceDropAfter{}',
  '@deepseek-ai/dsh-client-ui-workspace/Rows.module.css':
    '.wnFoaW_sessionRow{}.wnFoaW_title{}.wnFoaW_selected{}.wnFoaW_projectRow{}.wnFoaW_slot{}.wnFoaW_dropBefore{}.wnFoaW_dropAfter{}',
}

let seed = new Map()
let stateIndex = 0

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (init) => {
    const index = stateIndex
    stateIndex += 1
    const value = seed.has(index) ? seed.get(index) : typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useEffect: () => {},
  useRef: (value) => ({ current: value ?? null }),
  useCallback: (fn) => fn,
}

let captured = null
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  __ModuleLoader__: { load: (entry) => { captured = entry } },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  open: (url, target, features) => { opened.push({ url, target, features }) },
  getComputedStyle: () => ({ paddingTop: '8px' }),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}
const opened = []
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: { setProperty() {} } }),
  querySelector: (selector) => {
    const css = selector.match(/data-plugin-css="(.+)"\]$/)
    if (css !== null) return SHEETS[css[1]] === undefined ? null : { textContent: SHEETS[css[1]] }
    return null
  },
  addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
  documentElement: { hasAttribute: () => false }, body: {},
}

new Function('window', 'document', source)(globalThis.window, globalThis.document)

const components = {}
const ctx = {
  get: () => undefined,
  effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (_key, cb) => { cb() },
    register: (options, component) => { components[options.name ?? options.key] = component; return () => {} },
  },
}
captured.factory((id) => { if (id === 'react') return React; throw new Error('unexpected require ' + id) }).apply(ctx)

const Chip = components['sidebar.footer.action']
assert.equal(typeof Chip, 'function', 'balance chip must be registered')

function render(seeds) {
  seed = seeds ?? new Map()
  stateIndex = 0
  return Chip({ wide: true })
}

// 1) 初始渲染（还没拿到余额）：不能抛错
const initial = render()
assert.ok(initial !== null && initial !== undefined, 'initial render must return a node')
assert.equal(initial.props['data-dsh-rail-balance'], '', 'initial render must be the balance button')

// 2) ready + 有充值地址：提示改成"去充值"，点击打开该地址
const readyWithUrl = new Map([[0, {
  state: 'ready', total: '23.41', toppedUp: '23.00', granted: '0.41', currency: 'CNY', at: Date.now(),
  spentToday: '1.50', toppedUpToday: '10.00', grantedToday: '0.00',
  topUpUrl: 'https://platform.deepseek.com/top_up',
}]])
opened.length = 0
const withUrl = render(readyWithUrl)
assert.ok(String(withUrl.props.title).includes('去充值'), 'title must offer the top-up action')
withUrl.props.onClick({ shiftKey: false })
assert.deepEqual(opened.map((o) => o.url), ['https://platform.deepseek.com/top_up'], 'clicking must open the top-up page')
assert.equal(opened[0].features, 'noopener,noreferrer', 'open flags must match the host convention')

// 3) Shift + 点击不打开页面（走刷新分支）
opened.length = 0
withUrl.props.onClick({ shiftKey: true })
assert.equal(opened.length, 0, 'shift+click must not open a window')

// 4) ready 但没有地址：提示退回"点击立即刷新"
const readyPlain = new Map([[0, {
  state: 'ready', total: '23.41', toppedUp: '23.00', granted: '0.41', currency: 'CNY', at: Date.now(),
  spentToday: '0.00', toppedUpToday: '0.00', grantedToday: '0.00',
}]])
const plain = render(readyPlain)
assert.ok(String(plain.props.title).includes('点击立即刷新'), 'without a url the title must fall back to refresh')

// 5) 其余状态分支也要能渲染：未登录 / 查询失败（这些分支不会被上面两条覆盖）
const signedOut = render(new Map([[0, { state: 'signed-out' }]]))
assert.ok(String(signedOut.props.title).includes('API Key'), 'signed-out branch must render the sign-in hint')
const errored = render(new Map([[0, { state: 'error', message: '余额接口返回 502' }]]))
assert.ok(String(errored.props.title).includes('502'), 'error branch must surface the reason')
// 6) 主行：余额 · 今日 · 累计；悬浮说明给出累计与起始日
const withTotal = new Map([[0, {
  state: 'ready', total: '23.41', toppedUp: '23.00', granted: '0.41', currency: 'CNY', at: Date.now(),
  spentToday: '0.42', toppedUpToday: '0.00', grantedToday: '0.00',
  totalSpent: '3.70', totalSince: '2026-11-01', totalHasHistory: true,
  topUpUrl: 'https://platform.deepseek.com/top_up',
}]])
const totalTree = render(withTotal)
const nodes = []
const walk = (node) => {
  if (node === null || node === undefined) return
  if (typeof node === 'string') return
  nodes.push(node)
  for (const child of Array.isArray(node.children) ? node.children : []) walk(child)
}
walk(totalTree)
const textOf = (node) => (Array.isArray(node.children) ? node.children.filter((c) => typeof c === 'string').join('') : '')
const findAttr = (attr) => nodes.find((n) => n.props !== undefined && n.props[attr] === '')
const totalSpan = findAttr('data-dsh-rail-balance-total')
assert.ok(totalSpan !== undefined, '主行必须渲染累计那个数值')
assert.equal(textOf(totalSpan), '3.70', '累计值只留两位小数，不带符号')
const deltaSpan = findAttr('data-dsh-rail-balance-delta')
assert.ok(deltaSpan !== undefined && textOf(deltaSpan) === '0.42', '今日值仍然在，且不带箭头')
assert.ok(findAttr('data-dsh-rail-balance-sep') !== undefined, '余额与指标之间要有分隔')
assert.ok(findAttr('data-dsh-rail-balance-metrics') !== undefined, '指标必须成组，便于右对齐与折行')
const labels = nodes.filter((n) => n.props !== undefined && n.props['data-dsh-rail-balance-metric-label'] === '').map(textOf)
assert.equal(labels.length, 2, '两个指标各有自己的小标签，实际 ' + labels.length)
assert.ok(labels.join(',') === '今日,累计', '标签必须是“今日 / 累计”，实际 ' + labels.join(','))
assert.ok(String(totalTree.props.title).includes('3.70'), '悬浮说明要给出累计金额')
assert.ok(String(totalTree.props.title).includes('2026-11-01'), '悬浮说明要给出累计起始日')
// 7) 没有完整历史日期时，不显示累计（否则 Σ 与今日同值，像算错）
const noHistory = new Map([[0, {
  state: 'ready', total: '23.41', toppedUp: '23.00', granted: '0.41', currency: 'CNY', at: Date.now(),
  spentToday: '0.42', toppedUpToday: '0.00', grantedToday: '0.00',
  totalSpent: '0.42', totalSince: '2026-11-10', totalHasHistory: false,
}]])
const noHistoryTree = render(noHistory)
const noHistoryNodes = []
const walkNo = (node) => {
  if (node === null || node === undefined || typeof node === 'string') return
  noHistoryNodes.push(node)
  for (const child of Array.isArray(node.children) ? node.children : []) walkNo(child)
}
walkNo(noHistoryTree)
assert.ok(noHistoryNodes.find((n) => n.props !== undefined && n.props['data-dsh-rail-balance-total'] === '') === undefined, '没有历史天数时不能显示累计')
assert.ok(noHistoryNodes.find((n) => n.props !== undefined && n.props['data-dsh-rail-balance-delta'] === '') !== undefined, '今日仍要显示')
console.log('OK  没有历史天数：只显示今日，不显示累计')

console.log('OK  主行：余额 · 今日 · 累计，悬浮给出累计与起始日')

console.log('OK  未登录 / 失败分支都能渲染')

console.log('OK  初始渲染不抛错（TDZ 回归）')
console.log('OK  有地址：标题给"去充值"，点击打开页面')
console.log('OK  Shift + 点击：不打开页面')
console.log('OK  无地址：标题退回"点击立即刷新"')
console.log('\nchip checks passed')
