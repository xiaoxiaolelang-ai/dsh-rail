/**
 * 窄轨（dsh-rail）— Host 半边。
 *
 * 为什么需要 Host：凭据只在 Host 侧，浏览器拿不到 API Key，也调不到
 * `deepseekAccount`。所以余额在这里读，再通过 `connection` 的精确 fetch 路由
 * 交给 Client 半边渲染。路由本身已经在 connection 的信任与浏览器鉴权之后，
 * handler 不必再判一次。
 *
 * 取数优先级：内置 DeepSeek 账号（已登录即可，无需 Key）→ 环境变量/凭据里的 API Key。
 * 两条都拿不到时如实回报状态，不编造数字。
 */

const BALANCE_PATH = '/api/dsh-rail/balance'
const REFRESH_PATH = '/api/dsh-rail/balance/refresh'
/** 余额变化很慢；30 秒内复用上一次结果，避免连点刷新把上游打爆。 */
const CACHE_MS = 30_000
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const API_URL = 'https://api.deepseek.com/user/balance'
const VERSION = '0.1.0'

export const inject = ['connection']

/** 缓存与并发去重都挂在模块作用域：一个 profile 只有一份插件实例。 */
let cachedValue = null
let cachedAt = 0
let inflight = null

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/** `timezoneOffsetSeconds` 取相对 UTC 的秒数（东八区 +28800），不是 JS 的反号值。 */
function timezoneOffsetSeconds() {
  return -new Date().getTimezoneOffset() * 60
}

function clientMetadata() {
  return {
    version: VERSION,
    locale: 'zh-CN',
    timezoneOffsetSeconds: timezoneOffsetSeconds(),
  }
}

function pickWallet(wallets, preferred) {
  const list = Array.isArray(wallets) ? wallets : []
  return list.find((wallet) => wallet && wallet.currency === preferred) ?? list[0] ?? null
}

function amountOf(raw) {
  const value = Number.parseFloat(String(raw ?? ''))
  return Number.isFinite(value) ? value : 0
}

function walletCurrency(primary, bonus) {
  return primary?.currency ?? bonus?.currency ?? 'CNY'
}

/** 内置账号：`credential-stored` 才往下查，未登录直接回报 signed-out。 */
async function fromAccount(ctx) {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) return { state: 'unavailable' }

  let view
  try {
    view = await account.getState()
  } catch (error) {
    return { state: 'error', message: describe(error) }
  }
  if (view === null || view === undefined) return { state: 'unavailable' }
  if (view.status !== 'credential-stored') return { state: 'signed-out' }

  const result = await account.getBalance(clientMetadata())
  if (result === null) return { state: 'signed-out' }
  if (result.status === 'failed') return { state: 'error', message: '账号余额查询失败' }

  const toppedUp = pickWallet(result.value, 'CNY')
  const granted = pickWallet(result.bonusWallets, toppedUp?.currency ?? 'CNY')
  if (toppedUp === null && granted === null) return { state: 'error', message: '账号未返回余额' }

  const toppedUpValue = amountOf(toppedUp?.balance)
  const grantedValue = amountOf(granted?.balance)
  return {
    state: 'ready',
    source: 'account',
    currency: walletCurrency(toppedUp, granted),
    total: (toppedUpValue + grantedValue).toFixed(2),
    toppedUp: toppedUpValue.toFixed(2),
    granted: grantedValue.toFixed(2),
    at: Date.now(),
  }
}

/** API Key 兜底：先读环境变量，再读宿主凭据；明文只在本进程内使用。 */
async function fromApiKey(ctx) {
  let key = (process.env[API_KEY_REF] ?? '').trim()
  if (key === '') {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(API_KEY_REF)
        key = (resolved?.value ?? '').trim()
      } catch {
        // 这一档没取到就继续往下走，不当成错误。
      }
    }
  }
  if (key === '') return { state: 'signed-out' }

  const response = await fetch(API_URL, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!response.ok) return { state: 'error', message: `余额接口返回 ${response.status}` }

  const payload = await response.json()
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const info = infos.find((entry) => entry?.currency === 'CNY') ?? infos[0] ?? null
  if (info === null) return { state: 'error', message: '余额接口未返回账户' }

  return {
    state: 'ready',
    source: 'key',
    currency: info.currency ?? 'CNY',
    total: amountOf(info.total_balance).toFixed(2),
    toppedUp: amountOf(info.topped_up_balance).toFixed(2),
    granted: amountOf(info.granted_balance).toFixed(2),
    at: Date.now(),
  }
}

/** 账号优先；账号这条路给不出数字时再试 Key，两条都失败就回报更有信息量的那条。 */
async function readBalance(ctx) {
  let primary
  try {
    primary = await fromAccount(ctx)
  } catch (error) {
    primary = { state: 'error', message: describe(error) }
  }
  if (primary.state === 'ready') return primary

  let fallback
  try {
    fallback = await fromApiKey(ctx)
  } catch (error) {
    fallback = { state: 'error', message: describe(error) }
  }
  if (fallback.state === 'ready') return fallback
  if (primary.state === 'signed-out' || primary.state === 'unavailable') return fallback
  return primary
}

async function snapshot(ctx, force) {
  const fresh = force !== true && cachedValue !== null && Date.now() - cachedAt < CACHE_MS
  if (fresh) return cachedValue
  if (inflight === null) {
    inflight = readBalance(ctx)
      .then((value) => {
        if (value.state === 'ready') {
          cachedValue = value
          cachedAt = Date.now()
        }
        return value
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: BALANCE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => json(await snapshot(ctx, false)),
      }),
    'dsh-rail: balance route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: REFRESH_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => json(await snapshot(ctx, true)),
      }),
    'dsh-rail: balance refresh route',
  )
}
