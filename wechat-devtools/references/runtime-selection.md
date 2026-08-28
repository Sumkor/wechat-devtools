# 运行时选择

在启动、附着或选择自动化入口前读取本文。现代 Electron 与旧版 NW.js 的端口、进程、页面上下文和恢复方式不同，禁止混用。

## 判定原则

优先使用当前安装包和官方 installer/诊断返回的绝对路径，不假设固定操作系统路径。安装根未知时先按 [安装根发现](install-root-discovery.md) 生成并验证候选。安装形态只能作为证据，不能仅凭文件名判定：

- 现代 Electron 通常包含 `resources/app.asar` 或等价 Electron 资源，并可在当前版本中找到可用的 npm Automator 入口；通过一次 9420 WebSocket 握手和非空 `currentPage().path` 验证。
- 旧版 NW.js 通常包含 `code/package.nw`、NW.js daemon 或 legacy CDP 封装；这些是 `$wechat-devtools-nwjs` 的范围。
- `cli.bat` 的存在本身不能证明是 NW.js；现代 Electron 安装也可能保留它。

## 官方版本/运行时检查

官方 installer 的 `check-installation.mjs` 会读取安装包内的 package metadata，并返回 `version`。它同时检查两类运行时标记：

- Electron metadata：`<install-root>/resources/app.asar.unpacked/package.json`
- NW.js metadata：`<install-root>/code/package.nw/package.json`（macOS 位于 app bundle 的 `Contents/Resources` 下）

因此，`version` 可以作为版本证据，且官方稳定版说明“2.02 起基于 Electron”可作为发布线索；但不要只用版本字符串推断所有安装包。最终判定应同时满足：Electron metadata 存在、NW.js metadata 不存在、官方诊断未返回 `nw_runtime_incompatible`，并且实际 Automator 入口和 9420 WebSocket 能工作。`compatible: false` 仍可能带有 `version`，因为版本读取与 CLI 可用性是分开的检查。

## 路由

1. 先确认桌面宿主和安装形态，再确认 npm Automator 入口是否真实可用。
2. 判定为 Electron 后，解析并验证当前安装包实际提供的 Automator CLI（执行帮助或一次受控启动）；只有入口可用且 9420 握手成功时，才使用 npm `miniprogram-automator`。
3. 判定为 NW.js 后，停止本 Skill 的 npm/CDP 尝试，改用 [`wechat-devtools-nwjs`](../../wechat-devtools-nwjs/SKILL.md)。
4. 无法判定或证据冲突时停止启动变更，只报告检测结果和需要确认的安装根/入口。

## 不能迁移的 NW.js 约定

NW.js 的 daemon、HTTP `/updatePort`、`.ide` 状态文件、Named Pipe/Unix socket、`appservice/mainframe` CDP target 和 legacy 9420 稳定化逻辑不属于现代 npm 路径。现代路径只确认 Automator WebSocket 和页面就绪，不复用这些内部端口或恢复步骤。
