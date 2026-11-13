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
  flex-wrap: wrap;
  row-gap: 2px;
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
[data-dsh-rail-balance-dot] {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary, #8a8f98);
  transition: background-color 0.12s ease;
}
[data-dsh-rail-balance][data-tone='warn'] [data-dsh-rail-balance-dot] {
  background: var(--dsw-alias-state-warn-primary, #d68a1f);
}
[data-dsh-rail-balance][data-tone='low'] [data-dsh-rail-balance-dot] {
  background: var(--dsw-alias-state-error-primary, #c0392b);
}
[data-dsh-rail-balance][data-tone='muted'] [data-dsh-rail-balance-dot] {
  background: var(--dsw-alias-state-idle-primary, #b6b6b6);
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-rail-balance-dot] {
    transition: none;
  }
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
/* 三段分层：余额（主读数）│ 竖线 │ 指标组（标签 + 数值，右对齐）。
   指标不再用 ↓ / Σ 这类符号：标签本身说明含义，数值用等宽数字对齐。 */
[data-dsh-rail-balance-sep] {
  flex: none;
  align-self: center;
  width: 1px;
  height: 10px;
  margin: 0 8px;
  background: var(--dsw-alias-border-l2, var(--dsw-alias-label-tertiary));
  opacity: 0.5;
}
[data-dsh-rail-balance-metrics] {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  margin-left: auto;
}
[data-dsh-rail-balance-metric] {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  white-space: nowrap;
}
[data-dsh-rail-balance-metric-label] {
  flex: none;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0;
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-rail-balance-delta],
[data-dsh-rail-balance-total] {
  flex: none;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-rail-balance] {
    transition: none;
  }
}
`

    function railCss(n, active, extra) {
      const select = '.' + n.root
      const solid = (key) => '.' + n[key]
      const entry = extra !== undefined && extra !== null && extra.entry !== null ? '.' + extra.entry : null
      const wide = extra !== undefined && extra !== null && extra.wide !== null ? '.' + extra.wide : null
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
` + (entry === null ? '' : `
/* 0.2.2-rc.2 起面板多了一层 ${entry} 包裹行：窄栏里必须把这层也压成 40px 并居中，
   否则图标会被 flex 或 "宽行" 状态推偏。 */
${entry} {
  position: relative;
  width: 40px !important;
  display: flex !important;
  justify-content: center !important;
  min-width: 0;
}
`) + (wide === null ? '' : `
/* 宿主在"宽行"状态下给行留了 38px 的右侧内边距（给取消固定按钮）；
   窄栏里没有这个按钮，留着只会把图标挤到左边。 */
${wide} {
  width: 40px !important;
}
${wide} ${solid('panelRow')} {
  padding-right: 0 !important;
  background: 0 0 !important;
  border-inline-width: 0 !important;
}
`) + (active === null ? '' : `
/* 当前面板：左侧 2px 圆头强调条，和选中会话同一种语言。
   这个类名单独解析：宿主哪天改了它，只是这条强调条消失，窄栏布局不受影响。 */
.${active}::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe));
}
`)
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

    /**
     * 工作区 / 会话的结构层次。
     *
     * 原生的层次只靠 2px 行距和 4px 组距，扫一眼分不出"这是另一个工作区"。
     * 这里只加三样东西，全部用主题令牌 + alpha：组间的发丝线、工作区标题的字重、
     * 选中会话左侧的 2px 强调条。不做整块底色、不加边框盒子。
     */
    function structureCss(b, r, rows, guards) {
      // 三档线条，靠「色相 + 粗细 + 浓度」一起区分，而不是只调透明度：
      //   组间   —— 强调色的淡染（2px），读作"结构分界"
      //   会话间 —— 中性发丝线（1px，很淡），读作"列表纹理"
      //   竖线   —— 中性、比会话线再淡一档，读作"容器"
      // 全部用 alpha 叠在透明上：浅色下是淡彩/淡灰，深色下是亮彩/亮灰，两头都成立。
      // 没有引入新的色相：强调色本来就是"你在哪"的颜色，用低浓度染一下不会抢戏。
      const strong = 'color-mix(in srgb, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe)) 26%, transparent)'
      const session = 'color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 9%, transparent)'
      const guide = 'color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 7%, transparent)'
      // 拖拽指示器占着同一对伪元素。宿主的类名解析得到就加 :not 守卫；
      // 解析不到就退化成"不加守卫"——宁可拖拽时短暂重影，也不整层结构消失。
      const groupGuard = guards.group
      const rowBeforeGuard = guards.rowBefore
      const rowAfterGuard = guards.rowAfter
      return `
/* —— 工作区之间：圆头隔离带，只画在"第二个及以后"的组顶端 —— */
.${b.groupSection} {
  padding-top: 8px;
}
.${b.groupSection} + .${b.groupSection} {
  margin-top: 4px;
}
.${b.groupSection} + .${b.groupSection}${groupGuard}::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  top: 0;
  height: 1px;
  border-radius: 999px;
  background: ${strong};
  pointer-events: none;
}
/* —— 从工作区那一行下面拉一条圆头竖线，把它的会话括起来 ——
   起点由 JS 实测后写成 --dsh-rail-guide-top（组上内边距 + 工作区行高），
   CSS 这边不做任何算术：宿主改行高、改内边距、改字号，竖线都自己跟上。
   刻意不给兜底值：量到之前 top 解析成 auto、竖线高度归零也就是暂时不显示，
   也好过留一个写死的数字在宿主改版后默默错位。 */
.${b.groupSection}${groupGuard}::before {
  content: '';
  position: absolute;
  left: calc(16px + var(--dsh-workspace-indent, 0px));
  top: var(--dsh-rail-guide-top);
  bottom: 4px;
  width: 2px;
  border-radius: 999px;
  background: ${guide};
  pointer-events: none;
}
/* —— 工作区那一行本身 ——（不做吸顶：sticky 依赖祖先没有 overflow 裁剪，
   而宿主的行容器不受我们控制；不做就不会有"有时吸、有时不吸"的不确定） */
.${r.projectRow} {
  position: relative;
  font-weight: 500;
}
.${r.projectRow} .${r.slot} {
  color: var(--dsw-alias-label-secondary, #6b6f76);
}
/* —— 工作区行末尾的会话数：数字由 JS 数出来写在 data 属性上，纯展示 —— */
.${r.projectRow}[data-dsh-rail-count]::after {
  content: attr(data-dsh-rail-count);
  flex: none;
  margin-inline-start: auto;
  padding-inline: 4px;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  font-size: 11px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
/* 悬停时让位给行操作按钮，避免右边挤成一排。 */
.${r.projectRow}:hover[data-dsh-rail-count]::after {
  display: none;
}
/* —— 组内会话之间：1px 圆头发丝线，落在行距里 —— */
/* 组内才加间距；扁平视图保持原生 2px，别把它撑松。 */
.${b.groupSection} > * + * {
  margin-top: 4px;
}
.${rows.sessionRow} {
  position: relative;
}
.${rows.sessionRow}${rowAfterGuard}::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 8px;
  top: -3px;
  height: 1px;
  border-radius: 1px;
  background: ${session};
  pointer-events: none;
}
/* —— 键盘焦点：未选中的行获得焦点时露出同款强调条 —— */
.${rows.sessionRow}:not(.${rows.selected}):focus-within${rowBeforeGuard}::before,
.${r.projectRow}:focus-within${rowBeforeGuard}::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 999px;
  background: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
}
/* 选中会话：左侧 2px 圆头强调条（拖拽指示器占 ::before，这里让开） */
.${rows.sessionRow}.${rows.selected}${rowBeforeGuard}::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe));
}
`
    }

    /**
     * 会话数的缓存。
     *
     * 折叠起来的工作区，宿主不会渲染它的会话行——DOM 里根本没有可数的东西。
     * 所以只能记住"上次展开时数到的值"：展开时更新并落盘，折叠时用缓存补上。
     * 代价是折叠状态下显示的是"上次展开时的数字"，一个工作区在别处增删会话后
     * 要等它下次展开才会纠正。这是在不读宿主内部状态的前提下能做到的最好程度。
     */
    const countCache = { values: new Map(), loaded: false, dirty: false }
    const COUNT_STORE = 'dsh-rail:session-counts:v2'

    function loadCountCache() {
      if (countCache.loaded) return
      countCache.loaded = true
      try {
        const raw = window.localStorage.getItem(COUNT_STORE)
        const parsed = raw === null ? null : JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            const count = Number(value)
            if (Number.isFinite(count) && count > 0) countCache.values.set(key, count)
          }
        }
      } catch {
        // 读不到就当没有缓存
      }
    }

    function persistCountCache() {
      if (!countCache.dirty) return
      countCache.dirty = false
      try {
        const flat = {}
        for (const [key, value] of countCache.values) flat[key] = value
        window.localStorage.setItem(COUNT_STORE, JSON.stringify(flat))
      } catch {
        // 写不进去就只在内存里用
      }
    }

    /** 行身份：宿主给了 data-row-key（workspace:<id>）就用它，否则退回标题文字。 */
    function rowIdentity(row) {
      const explicit = row.getAttribute('data-row-key')
      if (explicit !== null && explicit !== '') return explicit
      return 'title:' + String(row.textContent ?? '').trim().slice(0, 120)
    }

    /** 运行时解析出来的原生类名；图标栏的 title 装饰效果也要用。 */
    const resolved = { root: null, panelList: null, panelRow: null, projectRow: null, groupSection: null, sessionRow: null }

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
      const [pending, setPending] = React.useState(true)
      const [failure, setFailure] = React.useState(null)

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
      /* 宿主给了充值地址就点一下去充值；没给就退回原来的"点一下刷新"。 */
      const topUpUrl = snapshot !== null && typeof snapshot.topUpUrl === 'string' && /^https:\/\//.test(snapshot.topUpUrl)
        ? snapshot.topUpUrl
        : null
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
      if (ready) label = label + '\n' + (topUpUrl === null ? t('balance.hint') : t('balance.hintTopUp'))
      /* 屏幕阅读器不需要那句“点击刷新”，换成纯数值说明。 */
      const accessible = label.split('\n')[0]

      /* 右侧那个数字 = 今日**累计消费**（host 累计余额的每次下降，充值不冲抵）。
         所以它不会因为充值变成负数或消失；今天还没花就不显示。 */
      const spent = ready ? Number.parseFloat(String(snapshot.spentToday ?? '')) : Number.NaN
      const gained = ready ? Number.parseFloat(String(snapshot.toppedUpToday ?? '')) : Number.NaN
      const grantedToday = ready ? Number.parseFloat(String(snapshot.grantedToday ?? '')) : Number.NaN
      const totalSpent = ready ? Number.parseFloat(String(snapshot.totalSpent ?? '')) : Number.NaN
      const totalSince = ready && typeof snapshot.totalSince === 'string' ? snapshot.totalSince : ''
      const spentVisible = Number.isFinite(spent) && spent >= 0.005
      const spentText = spentVisible ? spent.toFixed(2) : null
      /* 累计 = 已完成日期的合计 + 今天，与今日同一口径（只算余额下降）。 */
      /* 累计始终显示：第一天它与今日同值，但那是"观测起点"的真实含义，不该藏起来。 */
      const totalVisible = Number.isFinite(totalSpent) && totalSpent >= 0.005
      const totalText = totalVisible ? totalSpent.toFixed(2) : null
      const hasMetrics = spentVisible || totalVisible
      if (ready && Number.isFinite(spent)) {
        label = label + '\n' + t('balance.today') + ' ' + spent.toFixed(2)
        if (Number.isFinite(gained) && gained >= 0.005) {
          label = label + '\n' + t('balance.toppedUpToday') + ' ' + '+' + gained.toFixed(2)
        }
        if (Number.isFinite(grantedToday) && grantedToday >= 0.005) {
          label = label + '\n' + t('balance.grantedToday') + ' ' + '+' + grantedToday.toFixed(2)
        }
        if (Number.isFinite(totalSpent)) {
          const since = totalSince === '' ? '' : '（' + t('balance.since') + ' ' + totalSince + '）'
          label = label + '\n' + t('balance.total') + ' ' + symbol + totalSpent.toFixed(2) + since
        }
      }

      return h(
        'button',
        {
          type: 'button',
          'data-dsh-rail-balance': '',
          'data-tone': tone,
          'data-loading': pending && snapshot === null ? 'true' : 'false',
          title: label,
          'aria-label': accessible,
          onClick: (event) => {
            // Shift + 点击：立刻刷新（点击本身给了"去充值"，刷新只能挂在这里）
            if (event !== undefined && event.shiftKey === true) {
              void load(true)
              return
            }
            if (topUpUrl === null) {
              void load(true)
              return
            }
            try {
              window.open(topUpUrl, '_blank', 'noopener,noreferrer')
            } catch {
              void load(true)
            }
          },
        },
        h('span', { 'data-dsh-rail-balance-dot': '' }),
        h('span', { 'data-dsh-rail-balance-symbol': '' }, symbol),
        h('span', { 'data-dsh-rail-balance-amount': '' }, text),
        hasMetrics ? h('span', { 'data-dsh-rail-balance-sep': '', 'aria-hidden': 'true' }) : null,
        hasMetrics
          ? h(
              'span',
              { 'data-dsh-rail-balance-metrics': '' },
              spentText === null
                ? null
                : h(
                    'span',
                    { 'data-dsh-rail-balance-metric': '' },
                    h('span', { 'data-dsh-rail-balance-metric-label': '' }, t('balance.todayLabel')),
                    h('span', { 'data-dsh-rail-balance-delta': '' }, spentText),
                  ),
              totalText === null
                ? null
                : h(
                    'span',
                    { 'data-dsh-rail-balance-metric': '' },
                    h('span', { 'data-dsh-rail-balance-metric-label': '' }, t('balance.total')),
                    h('span', { 'data-dsh-rail-balance-total': '' }, totalText),
                  ),
            )
          : null,
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
      'balance.hintTopUp': '点击去充值（Shift + 点击立即刷新）',
      'balance.today': '今日花费',
      'balance.toppedUpToday': '今日充值',
      'balance.total': '累计',
      'balance.todayLabel': '今日',
      'balance.since': '自',
      'balance.grantedToday': '今日赠金',
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
      'balance.hintTopUp': 'Click to top up (Shift+click to refresh)',
      'balance.today': 'Spent today',
      'balance.toppedUpToday': 'Topped up today',
      'balance.total': 'Total',
      'balance.todayLabel': 'Today',
      'balance.since': 'since',
      'balance.grantedToday': 'Granted today',
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
            // 结构层次用到的类名单独解析：解析不到就只跳过这几条规则，
            // 不能让整个侧栏皮肤跟着失效。
            /* 0.2.2-rc.2 把 panelActive 改名为 panelEntryActive，并多了一层 panelEntry。
               两套名字都试：新宿主生效，旧宿主仍走原路径。 */
            const railActiveNew = resolveNames(SIDEBAR_SHEET, ['panelEntryActive'])
            const railActiveOld = resolveNames(SIDEBAR_SHEET, ['panelActive'])
            const railEntry = resolveNames(SIDEBAR_SHEET, ['panelEntry'])
            const railEntryWide = resolveNames(SIDEBAR_SHEET, ['panelEntryWide'])
            const railActive = railActiveNew ?? railActiveOld
            const browserStruct = resolveNames(BROWSER_SHEET, ['groupSection', 'flatList'])
            const rowsStruct = resolveNames(ROWS_SHEET, ['projectRow', 'slot'])
            // 拖拽指示器的类名是"可选"的：有就加 :not 守卫，没有就不加守卫。
            const browserDrop = resolveNames(BROWSER_SHEET, ['workspaceDropBefore', 'workspaceDropAfter'])
            const rowsDrop = resolveNames(ROWS_SHEET, ['dropBefore', 'dropAfter'])
            const parts = [BASE_CSS]
            if (browser !== null) parts.push(insetCss(browser.root))
            if (rows !== null) parts.push(hierarchyCss(rows))
            if (browserStruct !== null && rowsStruct !== null && rows !== null) {
              parts.push(structureCss(browserStruct, rowsStruct, rows, {
                group: browserDrop === null
                  ? ''
                  : ':not(.' + browserDrop.workspaceDropBefore + '):not(.' + browserDrop.workspaceDropAfter + ')',
                rowBefore: rowsDrop === null ? '' : ':not(.' + rowsDrop.dropBefore + ')',
                rowAfter: rowsDrop === null ? '' : ':not(.' + rowsDrop.dropAfter + ')',
              }))
            }
            if (sidebar !== null) {
              parts.push(railCss(
                sidebar,
                railActive === null ? null : (railActive.panelEntryActive ?? railActive.panelActive),
                {
                  entry: railEntry === null ? null : railEntry.panelEntry,
                  wide: railEntryWide === null ? null : railEntryWide.panelEntryWide,
                },
              ))
              resolved.root = sidebar.root
              resolved.panelList = sidebar.panelList
              resolved.panelRow = sidebar.panelRow
            }
            if (rowsStruct !== null) {
              resolved.projectRow = rowsStruct.projectRow
            }
            resolved.sessionRow = rows.sessionRow
            if (browserStruct !== null) {
              resolved.groupSection = browserStruct.groupSection
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
         * 实测一次竖线起点：组的上内边距 + 工作区那一行的实际高度。
         *
         * 为什么不留常量：行高和内边距都由宿主样式决定，宿主换字号、换内边距、
         * 甚至改行高，写死的数字就会偏几像素——而这类问题不会报错，只会一直难看。
         * 这里把两个值都量出来、合并成一个 --dsh-rail-guide-top 交给 CSS，
         * CSS 里不再做任何算术。量到之前每 800ms 试一次，量到就停；
         * 窗口尺寸变化时重量一次。
         */
        ctx.effect(() => {
          let timer = 0
          const measure = () => {
            if (resolved.root === null || resolved.projectRow === null || resolved.groupSection === null) return false
            const root = document.querySelector('.' + resolved.root)
            if (root === null) return false
            const group = root.querySelector('.' + resolved.groupSection)
            const row = root.querySelector('.' + resolved.projectRow)
            if (group === null || row === null) return false
            const rowHeight = row.getBoundingClientRect().height
            if (!(rowHeight > 0)) return false
            let padTop = 0
            try {
              padTop = Number.parseFloat(window.getComputedStyle(group).paddingTop) || 0
            } catch {
              padTop = 0
            }
            const guideTop = Math.round(padTop + rowHeight) + 'px'
            root.style.setProperty('--dsh-rail-guide-top', guideTop)
            // 同一份值也写到 :root：侧栏根节点若被重建，行内的自定义属性会丢，:root 不会。
            try {
              const html = document.documentElement
              if (html !== null && html !== undefined && html.style !== undefined && typeof html.style.setProperty === 'function') {
                html.style.setProperty('--dsh-rail-guide-top', guideTop)
              }
            } catch {
              // 写不了就只靠行内那份
            }
            return true
          }
          if (!measure()) {
            timer = window.setInterval(() => {
              if (measure() && timer !== 0) {
                window.clearInterval(timer)
                timer = 0
              }
            }, 800)
          }
          const onResize = () => { measure() }
          window.addEventListener('resize', onResize)
          return () => {
            if (timer !== 0) window.clearInterval(timer)
            window.removeEventListener('resize', onResize)
          }
        }, 'dsh-rail: head measurement')

        /**
         * 给每个工作区行标上"它下面有几个会话"。
         *
         * 数字写在行自己的 data 属性上，样式用 content: attr() 渲染——不插 DOM 节点，
         * 卸载时把属性删掉即可还原。只数直接子节点里的会话行：折叠起来的工作区
         * 本来就没有子行，此时不显示数字，而不是显示 0。
         */
        ctx.effect(() => {
          let timer = 0
          let frame = 0
          let frameIsTimeout = false
          let observer = null
          let disposed = false
          const paintCounts = () => {
            frame = 0
            if (disposed) return false
            if (resolved.root === null || resolved.groupSection === null || resolved.projectRow === null || resolved.sessionRow === null) return false
            const root = document.querySelector('.' + resolved.root)
            if (root === null) return false
            if (root.isConnected === false) {
              // 侧栏根节点被换掉了：旧 observer 还盯着已经卸载的节点，重挂一次。
              if (observer !== null) {
                observer.disconnect()
                observer = null
              }
              window.setTimeout(() => {
                if (!disposed && observer === null) attach()
              }, 0)
              return true
            }
            // 不假设"会话行是工作区行的子节点"，也不假设"组里有会话子节点"——
            // 宿主的树可能是 [组(只有表头), 会话...] 这种兄弟结构。
            // 按文档顺序走一遍：遇到工作区行就开一个新桶，之后见到的会话都算给它。
            // 嵌套组里的会话会自然归到更靠后的那个工作区行上。
            const rowsAll = root.querySelectorAll('.' + resolved.projectRow + ',.' + resolved.sessionRow)
            let current = null
            const counts = new Map()
            for (const node of rowsAll) {
              if (node.classList !== undefined && node.classList.contains(resolved.projectRow)) {
                current = node
                counts.set(node, 0)
                continue
              }
              if (current === null) continue
              counts.set(current, counts.get(current) + 1)
            }
            loadCountCache()
            countCache.dirty = false
            for (const [row, count] of counts) {
              const key = rowIdentity(row)
              if (count > 0) {
                row.setAttribute('data-dsh-rail-count', String(count))
                if (countCache.values.get(key) !== count) {
                  countCache.values.set(key, count)
                  countCache.dirty = true
                }
                continue
              }
              // 没数到东西：折叠状态下才允许用缓存补，展开却为空就是真空
              const collapsed = row.getAttribute('aria-expanded') === 'false'
              const cached = countCache.values.get(key)
              if (collapsed && Number.isFinite(cached) && cached > 0) {
                row.setAttribute('data-dsh-rail-count', String(cached))
              } else {
                row.removeAttribute('data-dsh-rail-count')
              }
            }
            persistCountCache()
            return true
          }
          const schedule = () => {
            if (frame !== 0 || disposed) return
            if (window.requestAnimationFrame !== undefined) {
              frame = window.requestAnimationFrame(paintCounts)
              frameIsTimeout = false
            } else {
              frame = window.setTimeout(paintCounts, 16)
              frameIsTimeout = true
            }
          }
          const attach = () => {
            const root = resolved.root === null ? null : document.querySelector('.' + resolved.root)
            if (root === null) return false
            paintCounts()
            observer = new MutationObserver(schedule)
            observer.observe(root, { childList: true, subtree: true })
            return true
          }
          if (!attach()) {
            timer = window.setInterval(() => {
              if (attach() && timer !== 0) {
                window.clearInterval(timer)
                timer = 0
              }
            }, 800)
          }
          return () => {
            disposed = true
            if (timer !== 0) window.clearInterval(timer)
            if (frame !== 0) {
              if (frameIsTimeout) window.clearTimeout(frame)
              else if (window.cancelAnimationFrame !== undefined) window.cancelAnimationFrame(frame)
            }
            if (observer !== null) observer.disconnect()
            // 还原：把自己写的属性删干净
            const rootName = resolved.root
            const rowName = resolved.projectRow
            if (rootName !== null && rowName !== null) {
              const root = document.querySelector('.' + rootName)
              if (root !== null) {
                for (const row of root.querySelectorAll('.' + rowName)) row.removeAttribute('data-dsh-rail-count')
              }
            }
          }
        }, 'dsh-rail: session counts')

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
