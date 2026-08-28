# npm Automator 参考

需要编写或维护 Node.js 小程序自动化脚本时读取本文。安装、运行时选择和官方 toolCall 入口见主 Skill 及对应参考。

## 安装

Skill 自带 [package.json](../package.json)，固定经过验证的 `miniprogram-automator@0.12.1`。在 Skill 目录执行 `npm install`，或在独立自动化项目中安装同一依赖；不要提交 `node_modules`。

## 连接与就绪

优先复用已有 Automator WebSocket 会话。使用 [scripts/automator-session.mjs](../scripts/automator-session.mjs) 提供的 `connectReady`、`currentPageReady` 和 `withTimeout`，不要只用 TCP 监听判断就绪：

```js
import { connectReady } from '<skill-root>/scripts/automator-session.mjs'

const { mp, page } = await connectReady({
  wsEndpoint: process.env.AUTOMATOR_ENDPOINT,
  timeoutMs: 15000,
})
try {
  // 在同一会话内串行完成导航、查询、点击和断言。
} finally {
  await mp.disconnect()
}
```

如果没有可复用会话，才由当前安装包启动一次 `auto --project <absolute-project> --auto-port <port>`。不要并发启动第二个 `auto`，不要在超时后立即重启；先检查当前页和动作后置条件。

## 页面操作

常用对象和方法包括：

```js
const page = await mp.currentPage()
await mp.switchTab('/pages/path/index')
await mp.navigateTo('/pages/detail/index?id=1')
const element = await page.$('.selector')
await element.tap()
await element.input('value')
await element.text()
await element.data()
await element.callMethod('methodName', argument)
await page.data()
await mp.screenshot({ path: './artifacts/page.jpg' })
```

`switchTab` 在现代 Electron 组合中已验证；`reLaunch` 可能悬挂并产生 `timeout waiting for automator response`，除非确有路由需求，否则优先使用 `switchTab`/`navigateTo`。自定义组件内部节点是否可见取决于当前运行时；查询失败时记录证据，不用坐标或 evaluate 伪造点击。

## 业务登录与接口

IDE/MCP 授权、开发者工具账号登录和小程序业务登录是不同状态。只能通过用户可见的正常登录流程完成业务登录，不读取或迁移其它会话的 token。

主动调用 `fetch` 或 `callWxMethod('request')` 是重放请求；捕获页面原请求使用 [capture-wx-request.mjs](../scripts/capture-wx-request.mjs)，边界见 [network-evidence.md](network-evidence.md)。
