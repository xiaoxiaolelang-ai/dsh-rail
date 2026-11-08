/**
 * 一次性冒烟检查（不属于插件本体）：用假 ctx 跑一遍 Host 半边，
 * 确认两条路由注册成功、账号优先/Key 兜底的链路按预期返回。
 */
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// --- 4. 今日净变化：当天第一次读数当基准，正数=花掉，负数=充值 ---
let liveTotal = '14.00'
const mutable = {
  getState: async () => ({ status: 'credential-stored' }),
  getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: liveTotal }], bonusWallets: [] }),
}
routes.clear()
apply(makeCtx({ deepseekAccount: mutable }))
async function readOnce() {
  const res = await routes.get('/api/dsh-rail/balance/refresh').fetch(new Request('http://x', { method: 'POST' }))
  return res.json()
}
const r1 = await readOnce()
assert.equal(r1.spentToday, '0.00', 'first reading sets the baseline, nothing spent yet')
liveTotal = '12.50'
const r2 = await readOnce()
assert.equal(r2.spentToday, '1.50', 'a drop accumulates into today\'s spend')
liveTotal = '20.00'
const r3 = await readOnce()
assert.equal(r3.spentToday, '1.50', 'a top-up must NOT turn the spend negative')
assert.equal(r3.toppedUpToday, '7.50', 'a top-up is recorded separately')
liveTotal = '19.00'
const r4 = await readOnce()
assert.equal(r4.spentToday, '2.50', 'spending after a top-up keeps accumulating')
assert.equal(r4.toppedUpToday, '7.50', 'topped-up total stays')
console.log('OK   今日消费累计:', r1.spentToday, '->', r2.spentToday, '->', r3.spentToday, '(充值 +' + r3.toppedUpToday + ')', '->', r4.spentToday)

// --- 5. 跨进程：基准落盘后，新进程仍能算出同一天的净变化 ---
{
  const home = mkdtempSync(pathMod.join(tmpdir(), 'dsh-rail-'))
  mkdirSync(pathMod.join(home, 'dsh-rail'), { recursive: true })
  const now = new Date()
  const key = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
  writeFileSync(pathMod.join(home, 'dsh-rail', 'day-spend.json'), JSON.stringify({ key, first: 20 }))
  const script = `const m = await import(${JSON.stringify('file://' + pathMod.join(here, 'index.js').replace(/\\\\/g, '/'))}); const v = { total: '18.00' }; m.stampDaySpend(v); process.stdout.write(String(v.spentToday ?? ''))`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
  assert.equal(out.trim(), '2.00', 'a fresh process must reuse the persisted day baseline')
  console.log('OK   跨进程读回落盘基准: 20.00 - 18.00 = ' + out.trim())
}

// --- 6. 账本优先：今天的花费直接取自 usage-ledger.json ---
{
  const { stampDaySpend } = await import('file://' + path.join(here, 'index.js').replace(/\\\\/g, '/'))
  const now = new Date()
  const pad = (v) => String(v).padStart(2, ' 0'.trim())
  const key = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  mkdirSync(pathMod.join(TEST_HOME, 'dsh-usage'), { recursive: true })
  writeFileSync(pathMod.join(TEST_HOME, 'dsh-usage', 'usage-ledger.json'), JSON.stringify({
    version: 1,
    days: { [key]: { 'deepseek-official': { 'deepseek-flash': { cost: 1.25 }, 'deepseek-pro': { cost: 0.5 } } } },
  }))
  const value = { total: '10.00' }
  stampDaySpend(value)
  assert.equal(value.spentSource, 'ledger', 'ledger should win over the balance delta')
  assert.equal(value.spentToday, '1.75', 'ledger costs are summed across providers and models')
  console.log('OK   账本优先: 今日花费 = ' + value.spentToday)
}

console.log('host smoke done')
