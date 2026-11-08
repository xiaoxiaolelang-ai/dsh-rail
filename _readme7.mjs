import fs from 'node:fs'
const p = 'README.md'
let s = fs.readFileSync(p, 'utf8')
const done = []
const rep = (from, to, label) => {
  if (!s.includes(from)) throw new Error('anchor missing: ' + label)
  s = s.replace(from, to)
  done.push(label)
}

rep(`- **未分组整组隐藏。**`,
`- **点一下去充值。** 余额条上的点击不再是"刷新"：宿主账号里带着平台充值地址，点一下直接在新窗口打开它；**Shift + 点击**才是立即刷新（平时每 60 秒自己刷，切回窗口也会刷）。宿主没给地址时，点击退回刷新。
- **未分组整组隐藏。**`.replace('\n- **未分组整组隐藏。**', ''), '功能条目')

rep(`- **跟随主题。**`,
`- **跟随主题。**`, 'noop')

rep(`## 更新记录

- **0.2.1**`,
`## 更新记录

- **0.2.2** —— 余额条点击改为**打开平台充值页**（地址来自宿主账号状态），Shift + 点击保留"立即刷新"。
- **0.2.1**`, '更新记录')

fs.writeFileSync(p, s)
console.log('applied:', done.join(' | '))
