/**
 * 一次性冒烟检查（不属于插件本体）：用假 ctx 跑一遍 Host 半边，
 * 确认两条路由注册成功、账号优先/Key 兜底的链路按预期返回。
 */
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import pathMod from 'node:path'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 整个测试跑在临时 DSH_HOME 里：不读真实账本、不写真实基准文件
const TEST_HOME = mkdtempSync(pathMod.join(tmpdir(), 'dsh-rail-home-'))
process.env.DSH_HOME = TEST_HOME

const here = path.dirname(fileURLToPath(import.meta.url))
const { apply, inject } = await import('file://' + path.join(here, 'index.js').replace(/\\/g, '/'))

assert.deepEqual(inject, ['connection'], 'host inject should declare connection')

const routes = new Map()
function makeCtx(services) {
  return {
    get: (name) => services[name],
    effect: (factory) => {
      const dispose = factory()
      return dispose
    },
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route)
          return async () => {
            routes.delete(route.path)
          }
        },
      },
    },
  }
}

// --- 1. 既没登录也没有 Key ---
apply(makeCtx({}))
assert.equal(routes.size, 2, 'both routes registered')
const first = await routes.get('/api/dsh-rail/balance').fetch(new Request('http://x/api/dsh-rail/balance'))
const firstBody = await first.json()
assert.equal(firstBody.state, 'signed-out', 'no account and no key reports signed-out')
console.log('OK   route registered, signed-out path:', JSON.stringify(firstBody))

// --- 2. 账号已登录：总额 = 充值 + 赠金 ---
const account = {
  getState: async () => ({ status: 'credential-stored' }),
  getBalance: async (client) => {
    assert.equal(typeof client.version, 'string')
    assert.equal(typeof client.timezoneOffsetSeconds, 'number')
    return {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '12.34' }],
      bonusWallets: [{ currency: 'CNY', balance: '1.66' }],
    }
  },
}
routes.clear()
apply(makeCtx({ deepseekAccount: account }))
const second = await routes.get('/api/dsh-rail/balance/refresh').fetch(
  new Request('http://x/api/dsh-rail/balance/refresh', { method: 'POST' }),
)
const secondBody = await second.json()
assert.equal(secondBody.state, 'ready')
assert.equal(secondBody.total, '14.00')
assert.equal(secondBody.toppedUp, '12.34')
assert.equal(secondBody.granted, '1.66')
assert.equal(secondBody.source, 'account')
console.log('OK   account path total:', secondBody.total, 'source:', secondBody.source)

// --- 3. 账号查询失败但没 Key：如实回报失败，不编数字 ---
routes.clear()
apply(makeCtx({ deepseekAccount: { getState: async () => ({ status: 'credential-stored' }), getBalance: async () => ({ status: 'failed' }) } }))
const third = await routes.get('/api/dsh-rail/balance/refresh').fetch(
  new Request('http://x/api/dsh-rail/balance/refresh', { method: 'POST' }),
)
const thirdBody = await third.json()
assert.equal(thirdBody.state, 'error')
assert.ok(typeof thirdBody.message === 'string' && thirdBody.message.length > 0)
console.log('OK   failed upstream reported as:', thirdBody.message)

// --- 4. 今日消费 / 今日充值 / 今日赠金：分钱包累计 ---
// 前面几节已经用别的钱包拆分初始化过模块级状态，这里换一个全新的模块实例 +
// 删掉落盘文件，保证从"干净的一天"开始测。
rmSync(pathMod.join(TEST_HOME, 'dsh-rail', 'day-spend.json'), { force: true })
const spendMod = await import('file://' + path.join(here, 'index.js').replace(/\\/g, '/') + '?spend=' + Date.now())
const applySpend = (ctx) => spendMod.apply(ctx)
let liveTotal = '14.00'
let liveBonus = '0.00'
const mutable = {
  getState: async () => ({
    status: 'credential-stored',
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  }),
  getBalance: async () => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: liveTotal }],
    bonusWallets: [{ currency: 'CNY', balance: liveBonus }],
  }),
}
routes.clear()
applySpend(makeCtx({ deepseekAccount: mutable }))
async function readOnce() {
  const res = await routes.get('/api/dsh-rail/balance/refresh').fetch(new Request('http://x', { method: 'POST' }))
  return res.json()
}
const r1 = await readOnce()
assert.equal(r1.spentToday, '0.00', 'first reading sets the baseline, nothing spent yet')
assert.equal(r1.topUpUrl, 'https://platform.deepseek.com/top_up', 'the host top-up url must reach the client')
console.log('OK   充值地址透传:', r1.topUpUrl)
liveTotal = '12.50'
const r2 = await readOnce()
assert.equal(r2.spentToday, '1.50', 'a drop accumulates into today\'s spend')
liveTotal = '22.50'
const r3 = await readOnce()
assert.equal(r3.spentToday, '1.50', 'a top-up must NOT turn the spend negative')
assert.equal(r3.toppedUpToday, '10.00', 'a 10 yuan top-up must show as exactly 10.00')
liveTotal = '20.50'
const r4 = await readOnce()
assert.equal(r4.spentToday, '3.50', 'spending after a top-up keeps accumulating')
assert.equal(r4.toppedUpToday, '10.00', 'topped-up total stays')
liveBonus = '5.00'
const r5 = await readOnce()
assert.equal(r5.spentToday, '3.50', 'a grant must not be counted as spend')
assert.equal(r5.grantedToday, '5.00', 'a grant is recorded separately')
assert.equal(r5.toppedUpToday, '10.00', 'a grant must not disturb the top-up total')
console.log('OK   分钱包累计: 消费', r1.spentToday, '->', r2.spentToday, '->', r4.spentToday, '| 充值 +' + r3.toppedUpToday, '| 赠金 +' + r5.grantedToday)

// --- 5. 跨进程：基准落盘后，新进程仍能算出同一天的净变化 ---
{
  const home = mkdtempSync(pathMod.join(tmpdir(), 'dsh-rail-'))
  mkdirSync(pathMod.join(home, 'dsh-rail'), { recursive: true })
  const now = new Date()
  const key = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
  writeFileSync(pathMod.join(home, 'dsh-rail', 'day-spend.json'), JSON.stringify({ key, upBase: 20, grBase: 0, spent: 0, upSum: 0, grSum: 0 }))
  const script = `const m = await import(${JSON.stringify('file://' + pathMod.join(here, 'index.js').replace(/\\\\/g, '/'))}); const v = { total: '18.00', toppedUp: '18.00', granted: '0.00' }; m.stampDaySpend(v); process.stdout.write(String(v.spentToday ?? ''))`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
  assert.equal(out.trim(), '2.00', 'a fresh process must reuse the persisted day baseline')
  console.log('OK   跨进程读回落盘基准: 20.00 - 18.00 = ' + out.trim())
}

// --- 6. 账本路径已移除：即使放一份 usage-ledger.json，也不再被读取 ---
{
  const { stampDaySpend } = await import('file://' + path.join(here, 'index.js').replace(/\\/g, '/'))
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  const key = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  mkdirSync(pathMod.join(TEST_HOME, 'dsh-usage'), { recursive: true })
  writeFileSync(pathMod.join(TEST_HOME, 'dsh-usage', 'usage-ledger.json'), JSON.stringify({
    version: 1,
    days: { [key]: { 'deepseek-official': { 'deepseek-flash': { cost: 1.25 } } } },
  }))
  const value = { total: '10.00', toppedUp: '10.00', granted: '0.00' }
  stampDaySpend(value)
  assert.equal(value.spentSource, undefined, '账本字段已移除，不应再出现')
  assert.notEqual(value.spentToday, '1.25', '账本里的 1.25 不得再被采用')
  assert.ok(Number.isFinite(Number(value.spentToday)), '今日必须仍是数字')
  assert.ok(Number.isFinite(Number(value.totalSpent)), '累计必须仍是数字')
  assert.equal(typeof value.totalSince, 'string', '必须带累计起始日')
  console.log('OK   账本不再参与: 今日 ' + value.spentToday + ' / 累计 ' + value.totalSpent)
}

// --- 7. 累计消费：v2 迁移不能重复计数，跨天要把昨日并入 ---
{
  const pad = (v) => String(v).padStart(2, '0')
  const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const today = new Date()
  const todayKey = dayKey(today)
  const yesterdayKey = dayKey(new Date(today.getTime() - 86400000))
  const statePath = pathMod.join(TEST_HOME, 'dsh-rail', 'day-spend.json')
  mkdirSync(pathMod.join(TEST_HOME, 'dsh-rail'), { recursive: true })
  // 每个用例都重新 import 一次（带版本参数），拿到干净的模块内状态
  const fresh = async (tag) => {
    const url = 'file://' + path.join(here, 'index.js').replace(/\\\\/g, '/') + '?case=' + tag
    return (await import(url)).stampDaySpend
  }

  writeFileSync(statePath, JSON.stringify({ v: 2, key: todayKey, upBase: 10, grBase: 0, spent: 1, upSum: 0, grSum: 0 }))
  {
    const stamp = await fresh('7a')
    const value = { total: '10.00', toppedUp: '10.00', granted: '0.00' }
    stamp(value)
    assert.equal(value.spentToday, '1.00', 'v2 当日消费保持 1.00')
    assert.equal(value.totalSpent, '1.00', 'v2 迁移后累计必须仍是 1.00（旧实现是 2.00）')
    assert.equal(value.totalHasHistory, false, '迁移当天没有完整历史日期')
    console.log('OK   v2 迁移不重复计数: 今日 ' + value.spentToday + ' / 累计 ' + value.totalSpent)
  }

  writeFileSync(statePath, JSON.stringify({
    v: 3, key: todayKey, upBase: 10, grBase: 0, spent: 0.5, upSum: 0, grSum: 0, totalSpent: 3, since: yesterdayKey,
  }))
  {
    const stamp = await fresh('7b')
    const value = { total: '10.00', toppedUp: '10.00', granted: '0.00' }
    stamp(value)
    assert.equal(value.spentToday, '0.50', '今日消费保持 0.50')
    assert.equal(value.totalSpent, '3.50', '累计 = 3.00 历史 + 0.50 今日')
    assert.equal(value.totalHasHistory, true, '有历史日期时必须为 true')
    assert.equal(value.totalSince, yesterdayKey, '起始日沿用历史')
    console.log('OK   v3 累计 = 历史 + 今日: ' + value.totalSpent + '（起始 ' + value.totalSince + '）')
  }

  writeFileSync(statePath, JSON.stringify({
    v: 3, key: yesterdayKey, upBase: 10, grBase: 0, spent: 2, upSum: 0, grSum: 0, totalSpent: 1, since: yesterdayKey,
  }))
  {
    const stamp = await fresh('7c')
    const value = { total: '10.00', toppedUp: '10.00', granted: '0.00' }
    stamp(value)
    assert.equal(value.spentToday, '0.00', '新的一天从 0 开始')
    assert.equal(value.totalSpent, '3.00', '累计 = 1.00 历史 + 2.00 昨日')
    assert.equal(value.totalHasHistory, true, '跨天后即算有历史')
    console.log('OK   跨天合并: 累计 ' + value.totalSpent + ' / 今日 ' + value.spentToday)
  }
}

console.log('host smoke done')
