---
name: wechat-devtools
description: 现代 Electron 微信开发者工具中的小程序 npm miniprogram-automator 自动化测试工作流；覆盖安装、启动/复用 9420 会话、页面操作、就绪检测和接口响应读取，并提示官方 skill/toolCall 的能力边界。
---

# WeChat DevTools：跨平台 npm Automator 工作流

## 目标与路由

使用 npm `miniprogram-automator` 编写可重复的 Node.js 自动化测试；官方 `wechatide-skill` + toolCall 只作为环境、编译、普通页面操作和调试的辅助路径。不要把具体项目、账号或业务流程写入本 Skill。

## 路由选择

默认将可重复的页面业务测试交给 npm Automator；IDE 生命周期、项目管理、编译和官方调试能力交给 toolCall。两者能力和限制的比较见 [README.md](README.md)，具体流程按需读取下方参考，且不要混用两套运行时会话。

安装根、官方 Skill 根或 CLI 绝对路径未知时，先读取 [安装根发现](references/install-root-discovery.md)，按“PATH/官方诊断 → Windows 卸载注册表 → 快捷方式 → 有限目录检查”的顺序生成候选，并用安装包 metadata 与实际入口验证；不要把某台机器的目录写成默认值。

随后读取 [运行时选择](references/runtime-selection.md)，结合官方 installer 返回的 `version`/`reason` 和安装包 metadata，判断当前安装属于现代 Electron 还是旧版 NW.js；不要只按版本字符串猜测：

- 现代 Electron：使用 npm Automator 和 9420 WebSocket；优先读取 [npm Automator 参考](references/npm-automator.md)。
- 旧版 NW.js：停止现代路径，改用 [`wechat-devtools-nwjs`](../wechat-devtools-nwjs/SKILL.md)；不要混用 daemon、CDP、端口或会话。

官方 skill/toolCall 的定位、入口解析和调用顺序见 [官方 toolCall 参考](references/official-toolcall.md)。

## 安装与依赖

本目录的 [package.json](package.json) 固定经过验证的 `miniprogram-automator@0.12.1`，Node.js 要求 `>=18`。在 Skill 目录或你自己的自动化项目目录执行一次 `npm install`；脚本会优先从当前项目、再从 Skill 目录解析依赖。不要把 `node_modules` 提交到 Skill。

## npm 会话规则

1. 解析当前平台可用的微信开发者工具安装根和 Automator 启动入口；只使用实际存在的入口，不把 Windows 文件名或路径套用到 macOS。
2. 如果目标 9420 WebSocket 已完成握手且 `currentPage().path` 非空，直接复用；禁止再次执行 `auto`。
3. 只有不存在可用会话时，才按当前平台和安装包文档执行一次 `auto --project <absolute-project> --auto-port <port>`，随后等待页面就绪。
4. `connect`、`currentPage`、导航、元素查询和点击都设置超时；超时后先复核页面路由、局部数据和动作后置条件，不立即重启运行时。
5. 同一 npm 会话内串行执行操作；重复启动会重建小程序运行上下文并可能丢失业务登录态。

通用连接、就绪和超时逻辑位于 [scripts/automator-session.mjs](scripts/automator-session.mjs)。页面操作使用 `currentPage`、`switchTab`、`navigateTo`、`$`、`$$`、`tap`、`input`、`text`、`data`、`callMethod` 和截图等 npm API；完整示例按需读取 npm 参考。当前 Electron 验证中 `switchTab` 稳定，`reLaunch` 曾导致 `timeout waiting for automator response`，优先使用前者。

## 网络响应

npm 包没有 Playwright 式 Network 事件。主动 `fetch`/`callWxMethod('request')` 是重放请求，不是页面原请求；应用层捕获使用 [scripts/capture-wx-request.mjs](scripts/capture-wx-request.mjs)。官方 `get_simulator_network` 不能读取 npm 9420 会话。需要完整网络包时使用同一 Electron 实例的 CDP Network 或显式代理。读取 [Network 取证](references/network-evidence.md) 了解证据判定和覆盖边界。

## 自定义组件与安全边界

官方 toolCall 和 npm Automator 对部分自定义组件内部节点的可见性不稳定；出现 `no such element` 时记录证据并改查宿主节点、页面路由或业务后置条件，不用坐标猜点、evaluate 伪造事件或无限重启。区分 IDE/MCP 授权、开发者工具登录和小程序业务登录，不能用一种状态冒充另一种。

## 按需加载

- 安装目录、官方 Skill 或 CLI 入口未知：[安装根发现](references/install-root-discovery.md)
- 启动、附着和平台入口：[启动与附着 SOP](references/startup-and-attach-sop.md)
- Electron/NW.js 判定：[运行时选择](references/runtime-selection.md)
- npm API、启动和页面操作：[npm Automator 参考](references/npm-automator.md)
- 官方路径：[官方 toolCall 参考](references/official-toolcall.md)
- 空白页、超时和组件边界：[自动化运行时 SOP](references/automation-runtime-sop.md)
- 请求/响应证据：[Network 取证](references/network-evidence.md)
