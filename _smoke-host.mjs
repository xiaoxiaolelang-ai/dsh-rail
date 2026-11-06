/**
 * 一次性冒烟检查（不属于插件本体）：用假 ctx 跑一遍 Host 半边，
 * 确认两条路由注册成功、账号优先/Key 兜底的链路按预期返回。
 */
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

console.log('host smoke done')
