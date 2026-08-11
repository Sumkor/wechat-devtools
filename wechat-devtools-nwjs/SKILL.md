---
name: wechat-devtools-nwjs
description: 旧版 NW.js 微信开发者工具自动化，用于通过 cli.bat、9420 和 miniprogram-automator 启动或复用小程序 Automator 会话，并执行页面操作、关键请求排查、截图、断言和受控 invoke。检测到现代 Electron 版时停止并推荐 wechat-devtools。
---

# WeChat DevTools NW.js Automation

## 核心原则

- 执行层只使用本 Skill 随附的 Node CLI/daemon，不要求 MCP Server，也不要临时写一次性 JS 脚本。
- 支持 Windows 和 macOS。普通命令统一使用跨平台 `node ./scripts/weapp-auto.js ...`；平台差异由启动器处理。
- 本 Skill 只执行已验证的旧版 NW.js 流程：`cli.bat → open → readiness → auto → 9420 → miniprogram-automator attach`。不得在本 Skill 内调用现代 `wechatide.cmd`、`wechatidecli.cmd` 或实现兼容层。
- 启动前检测安装目录运行时。检测到 Electron 时立即停止，推荐改用 `$wechat-devtools`；不得调用 `cli.bat`、探测 9420、启动旧 daemon 或尝试现代冷启动。
- `9420` 是 Automator WebSocket 端口；CDP 和本地 daemon IPC 是独立通道。端口和启动细节见 [references/diagnostics.md](references/diagnostics.md)。
- 默认使用 `default` 实例和 9420；同一实例内的自动化操作必须串行。
- 将启动状态明确分为“IDE 已启动、项目已打开、项目已构建、自动化运行中”。不得把 IDE 进程存在或 CLI 返回成功直接表述为项目已就绪；各状态的判据见 [references/diagnostics.md](references/diagnostics.md)。
- 真实业务操作遵循“关键动作前 `network clear`，动作后检查请求，再用路由、data、元素或截图确认页面结果”。

## 首次进入

1. 首次安装依赖：

```shell
npm install
```

发布版不携带 `node_modules`；首次使用时在 Skill 目录安装依赖。

2. 运行环境诊断。已知项目路径时必须同时传入，避免得到 `projectPath: null` 的低价值结果：

```shell
node .\scripts\weapp-auto.js env check --project '<miniapp-path>'
```

先读取输出中的 `runtime` 与 `legacySupported`：

- `runtime: nwjs`（或 macOS 旧版）且 `legacySupported: true`：继续使用本 Skill 的 Node CLI/daemon。
- `runtime: electron` 且 `legacySupported: false`：停止当前流程，向用户推荐 `$wechat-devtools`。不要在本 Skill 中执行任何现代或旧版启动命令。

3. 先检查是否已有可复用会话；仅在未连接或项目不匹配时启动：

```shell
node .\scripts\weapp-auto.js session status
```

4. 启动或复用 daemon + Automator 会话：

```shell
node .\scripts\weapp-auto.js session start --project '<miniapp-path>'
```

`session start` 按阶段执行，而不是把打开、编译和连接视为一个不可分割动作：先准备 IDE，再打开项目；只有目标工程 target、DOM 加载完成、页面主体非空、可见初始化忙碌状态消失同时满足，并保持约 3 秒防抖稳定后，才开启自动化并等待构建，最后连接 Automator。任一信号退化、工程窗口消失或重建时重新判定。任一阶段失败时停在当前阶段并按 [references/diagnostics.md](references/diagnostics.md) 恢复，不从头重放整个流程。

调用方中断或用户要求停止等待时，立即执行 `session cancel`，取消尚未完成的启动链；取消后再读取状态，不得让残留任务继续执行 `auto`。

只有 `currentPage` 返回非空路由时，才向用户报告“项目已打开并可自动化操作”。若只确认到前置状态，应准确报告停在“IDE 已启动”“项目已打开”或“项目已构建”，并继续按诊断流程收敛。

只需要 Automator、不需要抓包时显式关闭 CDP：

```shell
node .\scripts\weapp-auto.js session start --project '<miniapp-path>' --no-cdp
```

完整启动参数和恢复方式见 [references/diagnostics.md](references/diagnostics.md)。

5. 获取当前页或元素：

```shell
node .\scripts\weapp-auto.js page current
node .\scripts\weapp-auto.js element query --selector '.submit'
```

## 高频命令

- 页面与导航

```shell
node .\scripts\weapp-auto.js page stack
node .\scripts\weapp-auto.js page navigate --method navigateTo --url '/pages/home/index?id=1'
node .\scripts\weapp-auto.js page screenshot --path '.\tmp\home.png'
```

- 元素操作

```shell
node .\scripts\weapp-auto.js element tap --selector '.submit' --wait-route 'pages/result/index'
node .\scripts\weapp-auto.js element tap-text --text '提交'
node .\scripts\weapp-auto.js element input --selector 'input' --value 'hello'
```

- 手势与滚动

```shell
node .\scripts\weapp-auto.js gesture swipe --selector '.list' --direction up
node .\scripts\weapp-auto.js scroll-view to --selector 'scroll-view' --x 0 --y 800
```

- 数据、wx、断言

```shell
node .\scripts\weapp-auto.js page set-data --data-json '{"ready":true}'
node .\scripts\weapp-auto.js wx mock --method chooseLocation --result-json '{"name":"mock"}'
node .\scripts\weapp-auto.js assert visible --selector '.result'
node .\scripts\weapp-auto.js assert text --selector '.toast' --expected '成功'
```

## 路由到 references

- 需要完整命令面、启动顺序、daemon 约束时，读 [references/commands-and-sop.md](references/commands-and-sop.md)。
- 需要操作真实业务、快速定位路由和接口数据时，读 [references/business-automation-sop.md](references/business-automation-sop.md)。
- 需要抓取关键请求、读取响应体或排查接口失败时，读 [references/network-capture.md](references/network-capture.md)。
- 需要查看“哪些官方能力已直接封装、哪些仍通过 `invoke` 暴露”时，读 [references/capability-coverage.md](references/capability-coverage.md)。
- 需要 swipe、scroll-view、selector 选择策略时，读 [references/gestures-and-selectors.md](references/gestures-and-selectors.md)。
- 需要断言、`callMethod`、`callWxMethod`、受控 `invoke` 时，读 [references/assertions-and-invoke.md](references/assertions-and-invoke.md)。
- 需要启动覆盖优先级、9420 健康检查、故障恢复或用户明确要求高级实例隔离时，读 [references/diagnostics.md](references/diagnostics.md)。
