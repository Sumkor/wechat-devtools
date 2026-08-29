# wechat-devtools

用于让 AI Agent 操作微信小程序开发者工具的 Skills，覆盖现代 Electron 版和旧版 NW.js。两套运行时的启动方式、进程模型、端口、页面上下文、登录态和网络调试能力不同，不能混用。

## 选择 Skill

| 运行时 | Skill | 主路径 | 适用范围 |
| --- | --- | --- | --- |
| 现代 Electron | [`wechat-devtools`](wechat-devtools/) / `$wechat-devtools` | npm `miniprogram-automator` + 9420 Automator；同一 Electron 实例的标准 CDP 负责 Network/Console | 可重复的页面自动化、导航、元素操作、断言和真实请求取证 |
| 旧版 NW.js | [`wechat-devtools-nwjs`](wechat-devtools-nwjs/) / `$wechat-devtools-nwjs` | 旧版 daemon、CDP 和 Automator 封装 | 仅限明确识别为 NW.js 的旧安装 |

现代 Electron 的官方 `wechatide-skill` + toolCall 仍作为辅助路径，适合 IDE 状态、项目管理、编译刷新、模拟器管理、截图、console 和官方 simulator network；它不是现代版页面测试的主路径。

## 为什么现代版采用 Automator + CDP

主要原因是：官方 toolCall 对部分自定义组件的内部节点不可达，查询或点击可能返回 `no such element`，无法覆盖任意业务页面。因此现代版使用 npm Automator 操作页面；需要读取真实 Network、Console 或响应体时，再使用同一 Electron 实例的标准 CDP。官方 toolCall 仅保留用于 IDE、项目、编译和模拟器辅助操作，三种会话不得混用。

## 安装

克隆仓库后，将需要的 Skill 复制到 Agent 的个人 Skill 目录。目录位置由你的 Agent 配置决定，不要把微信开发者工具安装目录写入 Skill 配置。

```sh
git clone https://github.com/Sumkor/wechat-devtools.git
mkdir -p ~/.agents/skills
cp -R ./wechat-devtools/wechat-devtools ~/.agents/skills/wechat-devtools
```

Windows PowerShell 使用等价的目录创建和递归复制命令即可。

### 现代 Electron 版

现代 Skill 自带 [package.json](wechat-devtools/package.json)，依赖：

- `miniprogram-automator@0.12.1`
- `ws@8.18.3`

Node.js 要求 `>=18`。在 Skill 目录或独立自动化项目中安装依赖：

```sh
cd ~/.agents/skills/wechat-devtools
npm install
```

首次使用官方 toolCall 时，按当前开发者工具提示完成 MCP 客户端授权。安装根和入口解析见[安装根发现](wechat-devtools/references/install-root-discovery.md)。

### 旧版 NW.js

只有确认运行时是 NW.js 时，才安装旧版 Skill：

```sh
cp -R ./wechat-devtools/wechat-devtools-nwjs ~/.agents/skills/wechat-devtools-nwjs
cd ~/.agents/skills/wechat-devtools-nwjs
npm install
```

旧版 daemon、Named Pipe/Unix socket、legacy CDP target 和端口恢复逻辑只在 [`wechat-devtools-nwjs`](wechat-devtools-nwjs/) 内有效。

## 现代版使用流程

1. 读取[运行时选择](wechat-devtools/references/runtime-selection.md)，确认是 Electron 而不是 NW.js。
2. 按[安装根发现](wechat-devtools/references/install-root-discovery.md)解析当前平台的安装根、官方入口和 Automator 入口。
3. 优先复用已有 9420 WebSocket；如果需要网络/Console 证据，确认标准 CDP endpoint 属于同一 Electron 根实例。
4. 没有可复用会话时只冷启动一次。默认启用 loopback CDP，再由当前安装包提供的 Automator CLI 准备项目和 9420；不要重复执行 `auto`。
5. 使用 npm Automator 脚本执行页面操作；启动和就绪规则见[npm Automator 参考](wechat-devtools/references/npm-automator.md)。
6. 需要真实请求/响应时，先启动 CDP 监听，再执行一次目标页面动作；不要用主动 `fetch` 冒充原请求证据。

### 标准 CDP 网络监听

通用脚本位于 [`capture-cdp-network.mjs`](wechat-devtools/scripts/capture-cdp-network.mjs)，要求 CDP endpoint 仅绑定 loopback：

```sh
node <skill-root>/scripts/capture-cdp-network.mjs --cdp-port 9222 --url-contains /api/detail --method POST --duration-ms 30000 --output ./artifacts/detail.json
```

脚本会枚举 `/json/list`、附着候选 target、启用 Network、读取 `Network.getResponseBody` 并默认脱敏输出。先看到 `event: ready`，再执行 Automator 动作。完整 target 归属和证据边界见[Electron 标准 CDP](wechat-devtools/references/electron-cdp.md)。

### 无标准 CDP 时的回退

如果当前 Electron 实例没有标准 CDP：

- 可读取官方 toolCall 自己的 simulator network，但它不能读取独立 npm 9420 会话；
- 可使用 [`capture-wx-request.mjs`](wechat-devtools/scripts/capture-wx-request.mjs) 包装 `wx.request`，只能获得应用层回调；
- 也可使用显式 HTTP(S) 代理，但这不属于当前 Skill 的默认启动路径。

网络证据的优先级、脱敏和停止条件见[Network 取证](wechat-devtools/references/network-evidence.md)。

## 能力边界

- 页面业务测试：优先 npm Automator。
- 网络和 Console 观察：优先同一 Electron 实例的标准 CDP。
- IDE 生命周期、项目管理、编译刷新和官方调试：按需使用官方 toolCall。
- 官方 toolCall 和 npm Automator 对部分自定义组件内部节点都可能不可见；不要用坐标猜点、evaluate 伪造事件或无限重启。
- 标准 CDP 可以观察 Chromium target，但不代表能控制系统级授权面或所有原生界面。
- `wx.request` 包装器只覆盖安装之后的请求层调用，不覆盖完整底层网络包；`Network.getResponseBody` 也可能因二进制、流式或过大响应而缺失/截断。
- 发现 NW.js 后必须切换到 `$wechat-devtools-nwjs`，不要把旧 daemon/CDP 启动器迁移到现代 Electron。

## 文档

### 现代 Electron

- [Skill 主入口](wechat-devtools/SKILL.md)
- [npm Automator 参考](wechat-devtools/references/npm-automator.md)
- [Electron 标准 CDP](wechat-devtools/references/electron-cdp.md)
- [官方 skill + toolCall 参考](wechat-devtools/references/official-toolcall.md)
- [运行时选择](wechat-devtools/references/runtime-selection.md)
- [安装根发现](wechat-devtools/references/install-root-discovery.md)
- [启动与附着 SOP](wechat-devtools/references/startup-and-attach-sop.md)
- [自动化运行时 SOP](wechat-devtools/references/automation-runtime-sop.md)
- [Network 取证](wechat-devtools/references/network-evidence.md)

### 旧版 NW.js

- [NW.js Skill](wechat-devtools-nwjs/SKILL.md)
- [能力覆盖](wechat-devtools-nwjs/references/capability-coverage.md)
- [启动与故障诊断](wechat-devtools-nwjs/references/diagnostics.md)
- [网络捕获](wechat-devtools-nwjs/references/network-capture.md)

## License

[MIT License](LICENSE)
