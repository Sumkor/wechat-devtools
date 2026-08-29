---
name: wechat-devtools
description: 现代 Electron 微信开发者工具中的小程序自动化测试工作流；以 npm miniprogram-automator 操作页面、以标准 Electron CDP 捕获 Console/Network 和真实响应体，并以官方 wechatide-skill/toolCall 辅助项目与模拟器管理。
---

# WeChat DevTools：Electron Automator + CDP 工作流

## 目标与路由

使用 npm `miniprogram-automator` 编写可重复的页面自动化，并使用同一 Electron 实例的标准 CDP 捕获 Console、Network 与真实响应体；官方 `wechatide-skill` + toolCall 作为环境、项目、编译、模拟器和官方调试辅助。不要把具体项目、账号或业务流程写入本 Skill。

## 路由选择

默认架构是“9420 Automator 控制页面 + 标准 Electron CDP 观察网络/Console”。新启动现代 Electron 时默认同时启用 loopback CDP，只有用户明确要求不启用时才使用无 CDP 模式。IDE 生命周期、项目管理、编译和官方调试能力可交给 toolCall。两者能力和限制的比较见 [README.md](README.md)，具体流程按需读取下方参考。官方 toolCall 运行时与 npm 9420 会话不得互相冒充；标准 CDP 必须证明属于承载该 9420 项目的同一个 Electron 根实例。

安装根、官方 Skill 根或 CLI 绝对路径未知时，先读取 [安装根发现](references/install-root-discovery.md)，按“PATH/官方诊断 → Windows 卸载注册表 → 快捷方式 → 有限目录检查”的顺序生成候选，并用安装包 metadata 与实际入口验证；不要把某台机器的目录写成默认值。

随后读取 [运行时选择](references/runtime-selection.md)，结合官方 installer 返回的 `version`/`reason` 和安装包 metadata，判断当前安装属于现代 Electron 还是旧版 NW.js；不要只按版本字符串猜测：

- 现代 Electron：使用 npm Automator 和 9420 WebSocket 操作页面，需要网络响应时使用同一实例的标准 CDP；优先读取 [npm Automator 参考](references/npm-automator.md) 与 [Electron 标准 CDP](references/electron-cdp.md)。
- 旧版 NW.js：停止现代路径，改用 [`wechat-devtools-nwjs`](../wechat-devtools-nwjs/SKILL.md)；不要混用 daemon、CDP、端口或会话。

官方 skill/toolCall 的定位、入口解析和调用顺序见 [官方 toolCall 参考](references/official-toolcall.md)。

## 安装与依赖

本目录的 [package.json](package.json) 固定经过验证的 `miniprogram-automator@0.12.1` 与标准 CDP 脚本使用的 `ws@8.18.3`，Node.js 要求 `>=18`。在 Skill 目录或你自己的自动化项目目录执行一次 `npm install`；Automator 脚本会优先从当前项目、再从 Skill 目录解析依赖。不要把 `node_modules` 提交到 Skill。

## npm 会话规则

1. 解析当前平台可用的微信开发者工具安装根和 Automator 启动入口；只使用实际存在的入口，不把 Windows 文件名或路径套用到 macOS。
2. 如果目标 9420 WebSocket 已完成握手且 `currentPage().path` 非空，直接复用；禁止再次执行 `auto`。
3. 只有不存在可用会话时，才执行一次冷启动。默认先为同一个 Electron 根进程准备 loopback `--remote-debugging-port`，再按当前平台和安装包文档执行一次 `auto --project <absolute-project> --auto-port <port>`；只有用户显式要求无 CDP 时才跳过远程调试端口。
4. 默认优先使用空闲的 `9222`；被占用时在有限候选范围选择空闲端口，并记录最终 `cdpEndpoint`。启动后必须用 `/json/list` 和进程归属证明 CDP 与目标 9420 位于同一 Electron 实例。
5. `connect`、`currentPage`、导航、元素查询和点击都设置超时；超时后先复核页面路由、局部数据和动作后置条件，不立即重启运行时。
6. 同一 npm 会话内串行执行操作；重复启动会重建小程序运行上下文并可能丢失业务登录态。

通用连接、就绪和超时逻辑位于 [scripts/automator-session.mjs](scripts/automator-session.mjs)。页面操作使用 `currentPage`、`switchTab`、`navigateTo`、`$`、`$$`、`tap`、`input`、`text`、`data`、`callMethod` 和截图等 npm API；完整示例按需读取 npm 参考。当前 Electron 验证中 `switchTab` 稳定，`reLaunch` 曾导致 `timeout waiting for automator response`，优先使用前者。真实列表、搜索、详情、重组件和跨页面流程读取 [业务自动化 SOP](references/business-automation-sop.md)。

## 标准 CDP 与网络响应

npm 包没有 Playwright 式 Network 事件。现代 Electron 冷启动默认以 loopback `--remote-debugging-port` 暴露标准 CDP；需要完整请求/响应证据时，在业务动作前运行 [scripts/capture-cdp-network.mjs](scripts/capture-cdp-network.mjs)。脚本会枚举 `/json/list`、附着候选 page/WebView/逻辑层 target、执行 `Network.enable` 并用 `Network.getResponseBody` 读取页面原请求响应。主动 `fetch`/`callWxMethod('request')` 是重放请求，不算原请求证据。

标准 CDP 不可用时，才回退到官方 toolCall 自己的 simulator network、npm 9420 的 [wx.request 应用层捕获](scripts/capture-wx-request.mjs) 或显式代理。官方 `get_simulator_network` 不能读取独立 npm 9420 会话。完整启用、target 归属、脱敏和证据边界见 [Electron 标准 CDP](references/electron-cdp.md) 与 [Network 取证](references/network-evidence.md)。

## 自定义组件与安全边界

官方 toolCall 和 npm Automator 对部分自定义组件内部节点的可见性不稳定；出现 `no such element` 时记录证据并改查宿主节点、页面路由或业务后置条件，不用坐标猜点、evaluate 伪造事件或无限重启。区分开发者工具登录、多账号调试测试账号和小程序业务登录；CLI/MCP 授权只是额外的工具访问门禁，不能用任一状态冒充另一种。

业务登录依赖 `open-type="getPhoneNumber"` 时，读取 [`getPhoneNumber` 真实授权边界](references/get-phone-number-auth.md)。`testAccounts()` 空数组只表示没有可列出的已添加账号，不代表安装包没有内置虚拟账号；必须另行确认目标 9420 是否真正激活测试用户。未激活时，普通 `tap()` 和 `authorizeAllow()` 不能生成手机号 code；旧 `--auto-account` 在现代 CLI 中可能被静默忽略。

## 按需加载

- 安装目录、官方 Skill 或 CLI 入口未知：[安装根发现](references/install-root-discovery.md)
- 启动、附着和平台入口：[启动与附着 SOP](references/startup-and-attach-sop.md)
- Electron/NW.js 判定：[运行时选择](references/runtime-selection.md)
- npm API、启动和页面操作：[npm Automator 参考](references/npm-automator.md)
- 真实业务动作、重组件、等待和断言：[业务自动化 SOP](references/business-automation-sop.md)
- Electron target、CDP 启用和响应体捕获：[Electron 标准 CDP](references/electron-cdp.md)
- 官方路径：[官方 toolCall 参考](references/official-toolcall.md)
- 手机号登录、测试账号、同会话 CDP 与真机前置：[`getPhoneNumber` 真实授权边界](references/get-phone-number-auth.md)
- 空白页、超时和组件边界：[自动化运行时 SOP](references/automation-runtime-sop.md)
- 请求/响应证据：[Network 取证](references/network-evidence.md)
