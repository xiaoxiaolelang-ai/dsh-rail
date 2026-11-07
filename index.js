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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const BALANCE_PATH = '/api/dsh-rail/balance'
const REFRESH_PATH = '/api/dsh-rail/balance/refresh'
/** 余额变化很慢；30 秒内复用上一次结果，避免连点刷新把上游打爆。 */
const CACHE_MS = 30_000
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const API_URL = 'https://api.deepseek.com/user/balance'
const VERSION = '0.2.0'

export const inject = ['connection']

/**
 * 当天余额的基准值：当天第一次读数即为"今天开始时的余额"。
 * 正数差 = 今天花掉的钱；负数 = 今天有充值或赠金。
 * 基准会落到 DSH_HOME/dsh-rail/day-spend.json，所以重启当天仍然是同一个基准；
 * 跨天自动换新（日期键不同就重取）。
 */
const dayState = { key: '', first: null }

/** 基准落在 DSH_HOME 下的插件私有目录里：DSH 重启后"今日花费"仍然成立。 */
function stateFile() {
  const home = process.env.DSH_HOME === undefined || process.env.DSH_HOME === '' ? join(homedir(), '.dsh') : process.env.DSH_HOME
  return join(home, 'dsh-rail', 'day-spend.json')
}

function readPersisted() {
  try {
    const saved = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (saved !== null && typeof saved === 'object' && typeof saved.key === 'string' && Number.isFinite(Number(saved.first))) {
      return { key: saved.key, first: Number(saved.first) }
    }
  } catch {
    // 没写过、读不动、格式不对 —— 都当作"没有历史基准"
  }
  return null
}

function persistState(state) {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(state), 'utf8')
  } catch {
    // 写不进去就只在内存里算，功能降级但不出错
  }
}

function localDayKey(now) {
  return now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
}

/** 用量账本的日期键是补零的 ISO 形式（2026-11-07），和上面那个不补零的不是一套。 */
function ledgerDayKey(now) {
  const pad = (value) => String(value).padStart(2, '0')
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
}

function ledgerFile() {
  const home = process.env.DSH_HOME === undefined || process.env.DSH_HOME === '' ? join(homedir(), '.dsh') : process.env.DSH_HOME
  return join(home, 'dsh-usage', 'usage-ledger.json')
}

/**
 * 今日实际花费，来自用量账本（DSH_HOME/dsh-usage/usage-ledger.json：
 * days[YYYY-MM-DD][provider][model].cost）。有账本就以账本为准——它不受
 * 进程重启影响，也不会因为"今天还没花到一分钱"而显示不出来。
 * 账本不存在或格式变了就返回 null，交给余额差值那条路兜底。
 */
function todayCostFromLedger() {
  try {
    const ledger = JSON.parse(readFileSync(ledgerFile(), 'utf8'))
    const day = ledger === null || typeof ledger !== 'object' ? undefined : ledger.days?.[ledgerDayKey(new Date())]
    if (day === undefined || day === null || typeof day !== 'object') return null
    let sum = 0
    let any = false
    for (const provider of Object.values(day)) {
      if (provider === null || typeof provider !== 'object') continue
      for (const model of Object.values(provider)) {
        const cost = Number(model?.cost)
        if (Number.isFinite(cost)) {
          sum += cost
          any = true
        }
      }
    }
    return any ? sum : null
  } catch {
    return null
  }
}

/** 给一份 ready 结果补上"今日净变化"。算不出来就不写这两个字段，前端自然不显示。 */
function stampDaySpend(value) {
  const total = Number.parseFloat(String(value.total))
  if (!Number.isFinite(total)) return
  const key = localDayKey(new Date())
  if (dayState.key !== key) {
    const saved = readPersisted()
    dayState.key = key
    dayState.first = saved !== null && saved.key === key ? saved.first : total
    persistState({ key: dayState.key, first: dayState.first })
  }
  // 账本优先：它记的是真实花费，跨重启、跨"刚装插件"都成立。
  const ledgerCost = todayCostFromLedger()
  if (ledgerCost !== null) {
    value.spentToday = ledgerCost.toFixed(2)
    value.spentSource = 'ledger'
    return
  }
  if (!Number.isFinite(dayState.first)) return
  value.dayStart = dayState.first.toFixed(2)
  value.spentToday = (dayState.first - total).toFixed(2)
  value.spentSource = 'balance'
}

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

  // 没有超时的 fetch 一旦挂住，inflight 就永远不清空，余额条会一直停在"读取中"。
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(10_000)
    : undefined
  const response = await fetch(API_URL, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
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
          stampDaySpend(value)
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

export { stampDaySpend }
