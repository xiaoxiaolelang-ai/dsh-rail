# 窄轨 · dsh-rail

给 DeepSeek Harness 的侧边栏做减法：把面板图标收进一条窄栏，把宽度还给会话列表，并在底部栏上方常驻一条 DeepSeek 余额。

## 功能

- **图标窄栏。** 侧栏改成「40px 图标列 + 内容列」两列栅格：所有面板图标进左边竖栏，品牌、新建会话、工作区与会话列表占右边整列。工作区不再被挤在下半栏，会话标题能拿到完整宽度。图标悬停有原生 title 提示。
- **会话标题层次。** 普通会话次级色，选中 / 悬停 / 键盘聚焦升到主色，选中再加一档字重。相对时间保持三级色，三级层次分明。
- **滚动条边距。** 会话列表右缘按原生滚动条宽度 + 偏移内缩，行hover底色和滚动条对齐。
- **余额条。** 侧栏底部栏正上方一行：`¥ 23.41`。低于 50 转琥珀、低于 10 转红，数值变动时旁边带一个 ±差额（涨绿跌琥珀）。悬停看充值 / 赠金分项与更新时间，点一下立刻刷新，平时每 60 秒自动刷一次。
- **跟随主题。** 零处硬编码颜色，全部走 `--dsw-alias-*` 主题令牌，浅色/深色自动跟随。

## 安装

插件管理器里添加 `dsh-rail`，或者：

```
dsh plugin install dsh-rail
```

安装后刷新页面（首次安装或升级客户端代码时，正常退出 Desktop 再启动最稳妥）。

## 余额从哪来

- 优先用宿主内置的 DeepSeek 账号（`deepseekAccount` 服务）。已登录就能显示，**不需要 API Key**。
- 账号不可用时回退到 `DEEPSEEK_API_KEY`：先读环境变量，再读宿主凭据记录。明文只在 Host 进程内使用，不会下发到浏览器。
- 两条都拿不到时显示「未登录」，不编造数字。

凭据只存在 Host 侧，浏览器通过 `connection` 的精确 fetch 路由（`/api/dsh-rail/balance`）取已算好的 JSON。

## 工作原理

不替换任何 slot、不重排 React 树、不追加 DOM 节点：

- 原生类名运行时从注入的 CSS Module（`style[data-plugin-css="…"]`）里解析，宿主升级换哈希也不影响。
- 解析不到就只跳过对应那块样式，余额照常显示。
- 卸载时移除自己注入的样式表、监听器和 `title` 属性，全部还原。

## 兼容与边界

- 声明范围 `engines.dsh >= 0.2.2-rc.1`（在 `0.2.2-rc.1` 上验证）。
- 侧栏折叠成 56px 时，宿主自己会隐藏整个底部区，余额条跟着隐藏——这是原生行为，本插件不去覆盖。
- 与修改侧栏结构或全局主题的其他皮肤插件可能互相覆盖样式。
- 与繁界（fanframe）同属侧栏外观类插件，建议二选一。

## 开发

```
node --check client.js        # 客户端语法
node _smoke.mjs               # 用假 ctx 跑一遍 apply，打印最终注入的 CSS
node _smoke-host.mjs          # 假 ctx 跑 Host 半边，验证取数链路
npm pack                      # 生成可分发的 tarball
```

阈值在 `client.js` 顶部：`WARN_AT = 50`、`LOW_AT = 10`；窄栏宽度在 `railCss()` 里。

## License

MIT

---

# dsh-rail (English)

A small sidebar plugin for DeepSeek Harness: panel icons move into a narrow 40px rail so the session list gets the whole width, session titles gain a three-level hierarchy, the list's scroll gutter matches the native scrollbar, and a DeepSeek balance line sits just above the sidebar footer.

- **Icon rail.** Two-column grid (40px icon column + content column). Panel icons stack vertically; brand, new session, workspaces and the session list keep the full right column. Icons get a native `title` tooltip. No DOM is added, moved or replaced.
- **Title hierarchy.** Idle sessions use the secondary label token; selected, hovered and keyboard-focused rows use the primary token; the selected row gains one weight step.
- **Balance line.** Shown above the footer (`¥ 23.41`), amber below 50 and red below 10, with a ±delta after a change. Hover for topped-up / granted detail and the refresh time; click to refresh now; polls every 60 seconds.
- **Themed.** No literal colours — only `--dsw-alias-*` tokens, so light and dark follow the host.

The balance comes from the host's `deepseekAccount` service (no API key needed when signed in), falling back to `DEEPSEEK_API_KEY`. Credentials never reach the browser; the client reads a pre-computed JSON document over an exact `connection` fetch route.

Requires DSH `>= 0.2.2-rc.1`. When the sidebar collapses to its 56px rail the host hides the footer, so the balance line hides with it.

MIT.
