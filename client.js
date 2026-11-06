/**
 * 窄轨（dsh-rail）— Client 半边。
 *
 * 只做三件事，全部 additive：
 *  1. 把侧栏改成「窄图标列 + 内容列」两列栅格：面板图标进 40px 竖栏，
 *     品牌 / 新建会话 / 工作区与会话列表留在右侧内容列。
 *  2. 会话标题的明暗层次：普通=次级色，选中/悬停=主色，选中再加一档字重。
 *  3. 会话列表的滚动条边距对齐原生滚动条宽度。
 * 再加上侧栏底部的一条余额：由 Host 读，这里只渲染。
 *
 * 不替换任何 slot、不改 React 树、不写死颜色：原生类名运行时从注入的
 * CSS Module 里解析（宿主升级换哈希也不影响），颜色全走主题令牌。
 * 解析不到就跳过对应那部分样式，余额照常显示。
 */
window.__ModuleLoader__.load({
  id: 'dsh-rail',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-rail'
    const BALANCE_URL = '/api/dsh-rail/balance'
    const REFRESH_URL = '/api/dsh-rail/balance/refresh'
    /** 余额变化慢，60 秒一轮足够；窗口重新获得焦点时也会补一次。 */
    const POLL_MS = 60_000
    /** 数值分层：低于这两个数就换色（后面可以做成插件配置）。 */
    const WARN_AT = 50
    const LOW_AT = 10

    const SIDEBAR_SHEET = '@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css'
    const SIDEBAR_KEYS = [
      'root',
      'collapsed',
      'logoRow',
      'newSession',
      'panelList',
      'panelRow',
      'panelTitle',
      'regionArea',
      'footArea',
      'footerActions',
    ]
    const BROWSER_SHEET = '@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css'
    const ROWS_SHEET = '@deepseek-ai/dsh-client-ui-workspace/Rows.module.css'

    /** 从注入的 CSS Module 里取 `<hash>_<local>` 形式的真实类名。 */
    function resolveNames(sheet, keys) {
      if (typeof document === 'undefined') return null
      const tag = document.querySelector('style[data-plugin-css="' + sheet + '"]')
      if (tag === null) return null
      const text = tag.textContent || ''
      const names = {}
      for (const key of keys) {
        const match = text.match(new RegExp('\\.([A-Za-z0-9_-]+_' + key + ')(?![A-Za-z0-9_-])'))
        if (match === null) return null
        names[key] = match[1]
      }
      return names
    }

    /** 余额条自身的样式：只依赖主题令牌，不依赖任何原生类名。 */
    const BASE_CSS = `
[data-dsh-rail-balance] {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  /* 列表 slot 的条目直接就是底部动作条（flex）的子项：占满一整行并排到最前，
     于是余额条落在“设置 / 账户”那一栏的正上方。 */
  flex: 0 0 100%;
  order: -1;
  width: 100%;
  height: 28px;
  margin: 2px 0 4px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition: background-color 0.12s ease;
}
@media (hover: hover) {
  [data-dsh-rail-balance]:hover {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  }
}
[data-dsh-rail-balance]:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: -2px;
}
[data-dsh-rail-balance][data-loading='true'] {
  opacity: 0.6;
}
[data-dsh-rail-balance-symbol] {
  flex: none;
  font-size: 11px;
  opacity: 0.75;
}
[data-dsh-rail-balance-amount] {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
}
[data-dsh-rail-balance][data-tone='warn'] [data-dsh-rail-balance-amount] {
  color: var(--dsw-alias-state-warn-primary);
}
[data-dsh-rail-balance][data-tone='low'] [data-dsh-rail-balance-amount] {
  color: var(--dsw-alias-state-error-primary);
}
[data-dsh-rail-balance][data-tone='muted'] [data-dsh-rail-balance-amount] {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-rail-balance-delta] {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-rail-balance-delta][data-tone='down'] {
  color: var(--dsw-alias-state-warn-primary);
}
[data-dsh-rail-balance-delta][data-tone='up'] {
  color: var(--dsw-alias-state-success-primary);
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-rail-balance] {
    transition: none;
  }
}
`

    function railCss(n) {
      const select = '.' + n.root
      const solid = (key) => '.' + n[key]
      return `
${select} {
  display: grid !important;
  grid-template-columns: 40px minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  column-gap: 4px;
}
${select}${solid('collapsed')} {
  display: flex !important;
  grid-template-columns: none;
  grid-template-rows: none;
}
${select} > :not(${solid('panelList')}):not(${solid('regionArea')}):not(${solid('footArea')}) {
  grid-column: 2;
  min-width: 0;
}
${solid('panelList')} {
  grid-column: 1;
  grid-row: 1 / 4;
  align-self: start;
  display: flex !important;
  flex-direction: column;
  gap: 4px;
  width: 40px;
  max-height: 100%;
  margin: 0 !important;
  padding: 2px 0 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
${solid('panelList')}::-webkit-scrollbar {
  display: none;
}
${solid('panelRow')} {
  position: relative;
  justify-content: center !important;
  width: 36px !important;
  height: 36px !important;
  min-height: 36px !important;
  margin: 0 auto !important;
  padding: 0 !important;
  border-inline-width: 0 !important;
}
/* 只把文字从视觉上收起来：按钮的无障碍名字仍在。 */
${solid('panelList')} ${solid('panelTitle')} {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
}
${solid('regionArea')} {
  grid-column: 2;
  grid-row: 3;
  min-height: 0;
}
${solid('footArea')} {
  grid-column: 1 / -1;
  grid-row: 4;
}
${solid('footerActions')} {
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
${solid('footerActions')} [data-slot='sidebar.footer.action'] {
  display: contents !important;
}
`
    }

    /** 滚动条边距：让列表右缘正好贴住原生滚动条，而不是再多让一截内边距。 */
    function insetCss(root) {
      return `.${root} {
  --dsh-session-list-edge-inset: calc(
    var(--dsh-session-list-scrollbar-width, 5px) + var(--dsh-session-list-scrollbar-offset, 2px)
  );
}
`
    }

    /** 会话标题三档：普通=次级色，选中/悬停=主色，选中再加一档字重。 */
    function hierarchyCss(r) {
      const row = '.' + r.sessionRow
      return `${row} {
  color: var(--dsw-alias-label-secondary);
}
${row}:hover,
${row}.${r.selected},
${row}:focus-within {
  color: var(--dsw-alias-label-primary);
}
${row}.${r.selected} .${r.title} {
  font-weight: 500;
}
`
    }

    /** 运行时解析出来的原生类名；图标栏的 title 装饰效果也要用。 */
    const resolved = { root: null, panelList: null, panelRow: null }

    function currencySymbol(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    function formatAmount(raw) {
      const value = Number.parseFloat(String(raw ?? ''))
      if (!Number.isFinite(value)) return '—'
      return value.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }

    function toneOf(raw) {
      const value = Number.parseFloat(String(raw ?? ''))
      if (!Number.isFinite(value)) return 'ok'
      if (value < LOW_AT) return 'low'
      if (value < WARN_AT) return 'warn'
      return 'ok'
    }

    function clockOf(at) {
      const date = new Date(Number(at) || Date.now())
      const pad = (value) => String(value).padStart(2, '0')
      return pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function BalanceChip() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [delta, setDelta] = React.useState(null)
      const [pending, setPending] = React.useState(true)
      const [failure, setFailure] = React.useState(null)
      const settled = React.useRef(null)

      const load = React.useCallback(async (force) => {
        setPending(true)
        try {
          const response = await fetch(force ? REFRESH_URL : BALANCE_URL, {
            method: force ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const next = await response.json()
          const nextTotal = next?.state === 'ready' ? Number.parseFloat(String(next.total)) : null
          const previous = settled.current
          if (nextTotal !== null && previous !== null && Number.isFinite(previous)) {
            const change = nextTotal - previous
            setDelta(Math.abs(change) < 0.005 ? null : change)
          } else {
            setDelta(null)
          }
          settled.current = nextTotal
          setSnapshot(next)
          setFailure(null)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setPending(false)
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        const tick = () => {
          if (!alive) return
          if (typeof document !== 'undefined' && document.hidden) return
          void load(false)
        }
        void load(false)
        const timer = window.setInterval(tick, POLL_MS)
        const onFocus = () => tick()
        const onVisible = () => {
          if (typeof document !== 'undefined' && !document.hidden) tick()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      const t = BalanceChip.translate ?? ((key) => key)
      const ready = snapshot !== null && snapshot.state === 'ready'
      const symbol = ready ? currencySymbol(snapshot.currency) : '¥'
      let text = '—'
      let tone = 'muted'
      let label = t('balance.checking')

      if (ready) {
        text = formatAmount(snapshot.total)
        tone = toneOf(snapshot.total)
        label = [
          t('balance.updated') + ' ' + clockOf(snapshot.at),
          t('balance.toppedUp') + ' ' + symbol + formatAmount(snapshot.toppedUp),
          t('balance.granted') + ' ' + symbol + formatAmount(snapshot.granted),
        ].join(' · ')
      } else if (snapshot !== null && snapshot.state === 'signed-out') {
        text = t('balance.signedOut')
        label = t('balance.signedOutHint')
      } else if (snapshot !== null && snapshot.state === 'error') {
        text = '—'
        label = String(snapshot.message ?? failure ?? t('balance.unavailable'))
      } else if (failure !== null) {
        text = '—'
        label = failure
      }
      if (ready) label = label + '\n' + t('balance.hint')
      /* 屏幕阅读器不需要那句“点击刷新”，换成纯数值说明。 */
      const accessible = label.split('\n')[0]

      const deltaTone = delta === null ? 'flat' : delta > 0 ? 'up' : 'down'
      const deltaText =
        delta === null
          ? null
          : (delta > 0 ? '+' : '−') + Math.abs(delta).toFixed(2)

      return h(
        'button',
        {
          type: 'button',
          'data-dsh-rail-balance': '',
          'data-tone': tone,
          'data-loading': pending && snapshot === null ? 'true' : 'false',
          title: label,
          'aria-label': accessible,
          onClick: () => void load(true),
        },
        h('span', { 'data-dsh-rail-balance-symbol': '' }, symbol),
        h('span', { 'data-dsh-rail-balance-amount': '' }, text),
        deltaText === null
          ? null
          : h(
              'span',
              { 'data-dsh-rail-balance-delta': '', 'data-tone': deltaTone },
              deltaText,
            ),
      )
    }

    const zh = {
      'balance.checking': '读取余额…',
      'balance.signedOut': '未登录',
      'balance.signedOutHint': '没有可用的 DeepSeek 账号或 API Key，先在设置里登录或填 Key',
      'balance.unavailable': '余额暂不可用',
      'balance.updated': '更新于',
      'balance.toppedUp': '充值',
      'balance.granted': '赠金',
      'balance.hint': '点击立即刷新',
    }

    const en = {
      'balance.checking': 'Reading balance…',
      'balance.signedOut': 'Not signed in',
      'balance.signedOutHint': 'No DeepSeek account or API key is available. Sign in or add a key in Settings.',
      'balance.unavailable': 'Balance unavailable',
      'balance.updated': 'Updated',
      'balance.toppedUp': 'Topped up',
      'balance.granted': 'Granted',
      'balance.hint': 'Click to refresh',
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-rail: dictionaries')

        const bound = ctx.locale.bind(NS)
        /** 字典还没生效时 bind 会把 key 原样返回，这里兜到中文，避免界面露出 key。 */
        const t = (key, vars) => {
          const value = bound(key, vars)
          return value === key ? zh[key] ?? key : value
        }
        BalanceChip.translate = t

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.dshRail = 'look'
          document.head.appendChild(tag)

          let disposed = false
          let observer = null
          let timer = 0

          const paint = () => {
            if (disposed) return true
            const sidebar = resolveNames(SIDEBAR_SHEET, SIDEBAR_KEYS)
            const browser = resolveNames(BROWSER_SHEET, ['root'])
            const rows = resolveNames(ROWS_SHEET, ['sessionRow', 'title', 'selected'])
            const parts = [BASE_CSS]
            if (browser !== null) parts.push(insetCss(browser.root))
            if (rows !== null) parts.push(hierarchyCss(rows))
            if (sidebar !== null) {
              parts.push(railCss(sidebar))
              resolved.root = sidebar.root
              resolved.panelList = sidebar.panelList
              resolved.panelRow = sidebar.panelRow
            }
            tag.textContent = parts.join('\n')
            return sidebar !== null && browser !== null && rows !== null
          }

          if (!paint()) {
            observer = new MutationObserver(() => {
              if (paint() && observer !== null) {
                observer.disconnect()
                observer = null
              }
            })
            observer.observe(document.head, { childList: true, subtree: true })
            timer = window.setTimeout(() => {
              if (observer !== null) {
                observer.disconnect()
                observer = null
              }
            }, 15_000)
          }

          return () => {
            disposed = true
            if (timer !== 0) window.clearTimeout(timer)
            if (observer !== null) observer.disconnect()
            tag.remove()
          }
        }, 'dsh-rail: styles')

        /**
         * 图标栏把文字收起来之后，宿主原本那个 Tooltip 是 `disabled: wide` 的，
         * 于是悬停看不到面板名字。这里只补一个原生 title，卸载时全部还原。
         */
        ctx.effect(() => {
          const owned = new Set()
          let listObserver = null
          let waitObserver = null
          let retry = 0
          let disposed = false

          const decorate = (list) => {
            if (disposed || resolved.panelRow === null) return
            list.querySelectorAll('.' + resolved.panelRow).forEach((button) => {
              if (button.hasAttribute('title')) return
              const label = button.getAttribute('aria-label')
              if (label === null || label === '') return
              button.setAttribute('title', label)
              owned.add(button)
            })
          }

          const find = () => {
            if (resolved.root === null || resolved.panelList === null) return null
            const root = document.querySelector('.' + resolved.root)
            return root === null ? null : root.querySelector('.' + resolved.panelList)
          }

          const start = () => {
            const list = find()
            if (list === null) return false
            decorate(list)
            const next = new MutationObserver(() => decorate(list))
            next.observe(list, { childList: true, subtree: true })
            listObserver = next
            return true
          }

          if (!start()) {
            waitObserver = new MutationObserver(() => {
              if (!start()) return
              if (waitObserver !== null) {
                waitObserver.disconnect()
                waitObserver = null
              }
            })
            waitObserver.observe(document.body, { childList: true, subtree: true })
            retry = window.setTimeout(() => {
              if (waitObserver !== null) {
                waitObserver.disconnect()
                waitObserver = null
              }
            }, 20_000)
          }

          return () => {
            disposed = true
            if (retry !== 0) window.clearTimeout(retry)
            if (waitObserver !== null) waitObserver.disconnect()
            if (listObserver !== null) listObserver.disconnect()
            owned.forEach((button) => button.removeAttribute('title'))
            owned.clear()
          }
        }, 'dsh-rail: rail tooltips')

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'dsh-rail-balance', order: -10, locale: NS },
            BalanceChip,
          ),
        )
      },
    }
  },
})
