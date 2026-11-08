# 窄轨 · dsh-rail

给 DeepSeek Harness 的侧边栏做减法：把面板图标收进一条窄栏，把宽度还给会话列表，把工作区与会话分出层次，并在底部栏上方常驻一条 DeepSeek 余额。

## 功能

- **图标窄栏。** 侧栏改成「40px 图标列 + 内容列」两列栅格：所有面板图标进左边竖栏，品牌、新建会话、工作区与会话列表占右边整列。工作区不再被挤在下半栏，会话标题能拿到完整宽度。图标悬停有原生 title 提示，当前面板左侧有一条 2px 强调条。
- **侧栏层次。** 工作区之间是一条 1px、强调色淡染的圆头分隔线；组内会话之间是一条 1px 中性发丝线；每个工作区下面拉一条淡竖线，把它自己的会话括起来；选中会话左侧 2px 强调条，键盘聚焦时未选中的行也露出同一条。工作区标题字重 500、文件夹图标提到二级色。细、淡、圆头——层次出来了，但不抢内容。
- **未分组整组隐藏。** 宿主把不属于任何工作区的会话收进「未分组」，而这个桶里绝大多数是子代理的执行痕迹。插件按宿主给它的空 workspace key 认出这一组并整组隐藏，不再占侧栏位置。
- **会话数。** 工作区行末尾显示它下面有几个会话（11px、三级色、等宽数字），悬停时让位给行操作按钮。
- **会话标题层次。** 普通会话次级色，选中 / 悬停 / 键盘聚焦升到主色，选中再加一档字重。相对时间保持三级色。
- **滚动条边距。** 会话列表右缘按原生滚动条宽度 + 偏移内缩，行 hover 底色和滚动条对齐。
- **余额条。** 侧栏底部栏正上方一行：状态圆点 + `¥ 23.41` + 今日净变化。圆点四档：正常中性灰、低于 50 琥珀、低于 10 红、未登录暗灰；数字本身也按同样阈值变色。点一下立刻刷新，平时每 60 秒自动刷一次，切回窗口时也会刷。悬停看充值 / 赠金分项、更新时间与今日花费。
- **跟随主题。** 零处硬编码颜色，全部走 `--dsw-alias-*` 主题令牌（包括线条的 alpha 叠加），浅色 / 深色自动跟随。

## 会话数是怎么来的

展开状态下数的是屏幕上真实的会话行；折叠状态下宿主根本不渲染那些行，所以用的是上次展开时记下的值（`localStorage`，键 `dsh-rail:session-counts:v2`）。

- 展开过一次之后，折叠状态也会一直显示；
- **首次启动、且该工作区处于折叠状态时不显示数字**——插件不猜，也不去读宿主内部状态；
- 某个工作区在别处增删了会话，折叠时显示的是旧值，等它下次展开才会纠正。

## 今日花费是怎么算的

- 优先读用量账本 `DSH_HOME/dsh-usage/usage-ledger.json`：把 `days[今天]` 下每个 provider / model 的 `cost` 求和。账本有当天记录时，它就是真实花费。
- 账本没有当天记录时退回「余额差值」：当天第一次读数当基准，基准落在 `DSH_HOME/dsh-rail/day-spend.json`，所以**重启当天不会清零**，跨天自动换新。
- 正数 = 今天花掉（`↓1.50`，中性灰），负数 = 今天充值 / 进赠金（`↑6.00`，绿色）。没有变化就不显示数字。

## 安装

插件管理器里添加 `dsh-rail`，或者：

```
dsh plugin install dsh-rail
```

安装后刷新页面（首次安装或升级客户端代码时，正常退出 Desktop 再启动最稳妥）。

## 余额从哪来

- 优先用宿主内置的 DeepSeek 账号（`deepseekAccount` 服务）。已登录就能显示，**不需要 API Key**。
- 账号不可用时回退到 `DEEPSEEK_API_KEY`：先读环境变量，再读宿主凭据记录。明文只在 Host 进程内使用，不会下发到浏览器。这条请求带 10 秒超时，不会让余额条卡在「读取中」。
- 两条都拿不到时显示「未登录」，不编造数字。

凭据只存在 Host 侧，浏览器通过 `connection` 的精确 fetch 路由（`/api/dsh-rail/balance`）取已算好的 JSON。

## 工作原理

不替换任何 slot、不重排 React 树、也不追加结构性 DOM 节点：

- 原生类名运行时从注入的 CSS Module（`style[data-plugin-css="…"]`）里解析，宿主升级换哈希也不影响。
- 结构样式用到的类名单独解析：解析不到只跳过那几条规则，窄栏与余额照常工作。
- 会话数只写在行自己的 `data` 属性上，由 CSS `content: attr()` 渲染，不插节点；卸载时逐个删掉。
- 卸载时移除自己注入的样式表、监听器、`title` 属性与计数属性，全部还原。

## 兼容与边界

- 声明范围 `engines.dsh >= 0.2.2-rc.1`（在 `0.2.2-rc.1` 上验证）。
- 侧栏折叠成 56px 时，宿主自己会隐藏整个底部区，余额条跟着隐藏——这是原生行为，本插件不去覆盖。
- 线条用「主文字色 + alpha」叠色，深色主题下取值更高，因为同样的 alpha 在深底上更难认。
- **没有做工作区吸顶**：`position: sticky` 要求行与滚动容器之间没有 `overflow` 裁剪，而宿主的行容器不受本插件控制；做了会出现「有时吸、有时不吸」，比不做更糟。
- 「未分组」是整组隐藏的：如果你哪天有正常会话因为工作区被删而落到未分组，它在侧栏里也看不到（会话本身还在，可以从归档或别处找回）。不想要这个行为，删掉 CSS 里那条 `[data-dsh-rail-ungrouped]` 规则即可。
- 与修改侧栏结构或全局主题的其他皮肤插件可能互相覆盖样式。
- 与繁界（fanframe）同属侧栏外观类插件，建议二选一。

## 更新记录

- **0.2.0** —— 侧栏层次（组间 / 会话间分隔线、组竖线、选中条、键盘焦点条）、工作区会话数、余额状态圆点与今日净变化；修复 Key 兜底请求无超时会让余额条永久停在「读取中」。
- **0.1.0** —— 图标窄栏、会话标题层次、滚动条边距、余额条。

## 开发

```
node --check client.js        # 客户端语法
node _smoke.mjs               # 假 ctx 跑一遍 apply，打印最终注入的 CSS（29 项）
node _test-degrade.mjs        # 拖拽类名缺失时结构层仍在（2 项）
node _test-counts.mjs         # 四种 DOM 形状下的会话计数（4 项）
node _smoke-host.mjs          # Host 半边取数与今日花费（6 项）
npm pack                      # 生成可分发的 tarball
```

阈值在 `client.js` 顶部：`WARN_AT = 50`、`LOW_AT = 10`；窄栏宽度在 `railCss()` 里。

## License

MIT

---

# dsh-rail (English)

A small sidebar plugin for DeepSeek Harness: panel icons move into a narrow 40px rail so the session list gets the whole width, workspaces and sessions gain a quiet visual hierarchy, and a DeepSeek balance line sits just above the sidebar footer.

- **Icon rail.** Two-column grid (40px icon column + content column). Panel icons stack vertically; brand, new session, workspaces and the session list keep the full right column. Icons get a native `title` tooltip, and the active panel gets a 2px accent bar. No structural DOM is added, moved or replaced.
- **Sidebar hierarchy.** A 1px rounded divider tinted with the accent colour between workspaces; a 1px neutral hairline between sessions inside a workspace; a faint vertical guide under each workspace header; a 2px accent bar on the selected session, reused for keyboard focus on any other row. Workspace titles get a 500 weight and their folder icon one step more contrast.
- **Session count.** Each workspace row ends with how many sessions sit under it — hidden while hovering so the row actions have room.
- **Title hierarchy.** Idle sessions use the secondary label token; selected, hovered and keyboard-focused rows use the primary token; the selected row gains one weight step.
- **Balance line.** Above the footer: a status dot, `¥ 23.41`, and today's net change. The dot is neutral when healthy, amber below 50, red below 10, grey when signed out. Click to refresh now; polls every 60 seconds and on window focus.
- **Themed.** No literal colours — only `--dsw-alias-*` tokens, alpha layering included, so light and dark follow the host.

Where the session count comes from: expanded workspaces are counted from the rows actually on screen; collapsed ones reuse the last value seen while expanded (`localStorage`, key `dsh-rail:session-counts:v2`). Nothing is shown for a workspace that has never been expanded in this profile — the plugin does not guess and does not read host internals.

Today's spend prefers the usage ledger at `DSH_HOME/dsh-usage/usage-ledger.json`; when that has no entry for today it falls back to the balance delta, with the day's baseline persisted at `DSH_HOME/dsh-rail/day-spend.json` so a restart does not reset it. Positive means spent today, negative means topped up or granted.

The balance comes from the host's `deepseekAccount` service (no API key needed when signed in), falling back to `DEEPSEEK_API_KEY` with a 10 second timeout. Credentials never reach the browser; the client reads a pre-computed JSON document over an exact `connection` fetch route.

Requires DSH `>= 0.2.2-rc.1`. When the sidebar collapses to its 56px rail the host hides the footer, so the balance line hides with it. Sticky workspace headers are deliberately not implemented: `position: sticky` needs no `overflow` clipping between the row and the scroll container, and the host's row container is outside this plugin's control.

MIT.
