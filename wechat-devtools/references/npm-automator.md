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

选择器优先使用稳定 class、id、组件标签和明确 ref，不依赖动态索引或运行时生成 ID。`page.$`/`page.$$` 不保证穿透自定义组件；从页面查询精确宿主，再逐层进入已确认的组件。重组件页避免宽泛遍历整个 `view`/`input` 树，具体决策见 [业务自动化 SOP](business-automation-sop.md)。

动作返回后使用条件轮询验证后置：优先顺序为目标 path、关键元素可见/文本、局部 data、目标接口和截图。操作超时不必然表示动作未发生，先复核后置条件再决定是否重做。

## 业务登录与接口

IDE/MCP 授权、开发者工具账号登录和小程序业务登录是不同状态。只能通过用户可见的正常登录流程完成业务登录，不读取或迁移其它会话的 token。

`open-type="getPhoneNumber"` 的真实授权、测试账号、`authorizeAllow()` no-op 判定、同会话 CDP 和真机自动化前置见 [`getPhoneNumber` 真实授权边界](get-phone-number-auth.md)。

主动调用 `fetch` 或 `callWxMethod('request')` 是重放请求；捕获页面原请求优先使用同一 Electron 实例的标准 CDP [capture-cdp-network.mjs](../scripts/capture-cdp-network.mjs)。标准 CDP 不可用时才回退到 [capture-wx-request.mjs](../scripts/capture-wx-request.mjs)，边界见 [network-evidence.md](network-evidence.md)。

## 标准 Electron CDP

9420 Automator 负责页面动作，标准 CDP 负责 Network/Console 观察。两者是同一测试编排中的不同通道，不是两套业务会话。先启动 CDP 监听并等待 `ready`，再由 Automator 执行一次目标动作：

```sh
node <skill-root>/scripts/capture-cdp-network.mjs --cdp-port 9222 --url-contains /detail --method POST --output ./artifacts/detail.json
```

完整 target 归属、启动和脱敏规则见 [Electron 标准 CDP](electron-cdp.md)。

## 同会话 CDP inspectee

当前现代 Electron 组合中，9420 原始协议实测支持 `App.CDPListProtocol` 和 `{ domain, method, params }` 形式的 `App.CDPCommand`。用通用只读脚本确认当前协议域：

```sh
node <skill-root>/scripts/probe-cdp-inspectee.mjs --inspectee
```

该入口是小程序 inspectee 协议，不是浏览器级 CDP endpoint；没有 `Target`/`Browser` 域时不能枚举 Electron BrowserWindow、WebView 或原生授权面。它也不是 `miniprogram-automator@0.12.1` 的公开类型 API，只用于版本绑定的只读取证，不用来调用业务 handler、伪造事件或改组件数据。
