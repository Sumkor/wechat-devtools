# wechat-devtools

让 AI Agent 操作微信小程序开发者工具的两个隔离 Skill：现代 Electron 版和旧版 NW.js。两套运行时的进程、端口、页面上下文、登录态和网络通道不同，不能混用。

## 选择 Skill

| 运行时 | Skill | 主自动化路径 | 适用范围 |
| --- | --- | --- | --- |
| 现代 Electron | [`wechat-devtools`](wechat-devtools/) / `$wechat-devtools` | npm `miniprogram-automator` + Automator WebSocket（通常为 9420） | 可重复的页面测试、导航、元素操作、断言和业务验证 |
| 旧版 NW.js | [`wechat-devtools-nwjs`](wechat-devtools-nwjs/) / `$wechat-devtools-nwjs` | 旧版 daemon、CDP 和 Automator 封装 | 仅限明确识别为 NW.js 的旧安装 |

现代版的官方 `wechatide-skill` + toolCall 仍作为辅助路径，用于 IDE 状态、项目管理、编译刷新、截图、console 和官方 simulator network。它不是现代 Skill 的主要页面测试入口。

### 为什么新版不把官方 toolCall 作为主路径

新版优先 npm Automator，主要是为了可重复的自动化测试：Node.js 脚本可以版本化、参数化、批量执行并加入断言，在同一 9420 会话中完成导航、元素操作、业务验证和响应读取。官方 toolCall 则与当前 IDE 版本、scene、工具注册表和授权状态绑定，适合 IDE 生命周期及调试操作；普通页面操作对部分自定义组件内部节点支持不稳定，可能出现 `no such element`，不能假设它能覆盖任意业务页面。npm 也不是能力更完整——它没有内置 Playwright 式 Network 事件，完整网络包仍需同一 Electron 实例的 CDP 或代理。

不要仅凭 `cli.bat`、版本字符串或某个固定安装目录判断运行时。先读取现代 Skill 的 [安装根发现](wechat-devtools/references/install-root-discovery.md) 和 [运行时选择](wechat-devtools/references/runtime-selection.md)，结合安装包 metadata、官方诊断结果和实际 Automator 连接确认。

## 安装

```sh
git clone https://github.com/Sumkor/wechat-devtools.git
mkdir -p ~/.agents/skills
cp -R ./wechat-devtools/wechat-devtools ~/.agents/skills/wechat-devtools
```

Windows PowerShell 可将最后两行替换为等价的目录创建和递归复制命令；路径使用你自己的 Skill 目录，不要写死系统安装目录。

### 现代 Electron Skill

现代 Skill 自带 [package.json](wechat-devtools/package.json)，固定经过验证的 `miniprogram-automator@0.12.1`，Node.js 要求 `>=18`：

```sh
cd ~/.agents/skills/wechat-devtools
npm install
```

也可以在独立自动化项目中安装同一依赖；通用脚本会优先从当前项目、再从 Skill 目录解析。首次使用官方 toolCall 时，按当前开发者工具提示完成 MCP 客户端授权。

### 旧版 NW.js Skill

只有确认是 NW.js 时才复制并安装：

```sh
cp -R ./wechat-devtools/wechat-devtools-nwjs ~/.agents/skills/wechat-devtools-nwjs
cd ~/.agents/skills/wechat-devtools-nwjs
npm install
```

旧版 Skill 的 daemon、CDP target、端口恢复和网络监听逻辑只在 [`wechat-devtools-nwjs`](wechat-devtools-nwjs/) 内有效。

## 使用

直接描述业务目标即可，例如：

```text
$wechat-devtools 打开 <project-path> 并进入首页
$wechat-devtools 执行页面操作并验证结果
$wechat-devtools 捕获目标页面请求的响应字段
```

现代 npm 路径的通用网络监听脚本：

```sh
node <skill-root>/scripts/capture-wx-request.mjs \
  --duration-ms 30000 \
  --output ./artifacts/network.json
```

脚本附着已有 Automator 会话并监听当前页面的 `wx.request` 应用层回调，不执行页面动作；需要捕获某个动作时先启动监听，再执行另一个 Automator 测试脚本或在同一 Node 进程中复用逻辑。

## 能力边界

- npm Automator 适合可版本化、可重复执行的页面测试，但没有 Playwright 式内置 Network 事件。
- `capture-wx-request.mjs` 只覆盖包装器安装之后、经过 `wx.request` 的应用层请求；完整网络包需要同一 Electron 实例显式提供 CDP Network 或使用代理。
- 官方 toolCall 与 npm 9420 会话彼此隔离；官方 network 缓冲不能读取 npm 会话。
- 两条路径对部分自定义组件内部节点的可见性都可能受运行时限制；不要用坐标或 evaluate 伪造点击。
- 发现 NW.js 后必须切换到 `$wechat-devtools-nwjs`，不要把旧 daemon/CDP 逻辑迁移到现代 Electron。

## 文档

- [现代 Electron Skill](wechat-devtools/SKILL.md)
- [npm Automator 参考](wechat-devtools/references/npm-automator.md)
- [官方 skill + toolCall 参考](wechat-devtools/references/official-toolcall.md)
- [安装根发现](wechat-devtools/references/install-root-discovery.md)
- [运行时选择](wechat-devtools/references/runtime-selection.md)
- [启动与附着 SOP](wechat-devtools/references/startup-and-attach-sop.md)
- [Network 取证](wechat-devtools/references/network-evidence.md)
- [旧版 NW.js Skill](wechat-devtools-nwjs/SKILL.md)
- [旧版启动与故障诊断](wechat-devtools-nwjs/references/diagnostics.md)

## License

[MIT License](LICENSE)
