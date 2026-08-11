---
name: wechat-devtools
description: 现代 Electron 微信开发者工具官方 MCP/toolCall 工作流。按需读取已安装的 wechatide-skill 和工具定义，先确认项目导入元数据，再安全附着普通 GUI 或用官方传统 CLI 单项目冷启动，并由 wechatide.cmd 桥接 IDE 内部工具；用于打开/附着 IDE 与项目、授权、登录、编译、模拟器自动化、调试与 network 排查。检测到旧版 NW.js 时停止并推荐 wechat-devtools-nwjs。
---

# WeChat DevTools

## 边界

- 启动外壳只使用现代 Electron 开发者工具的官方桌面程序；授权与业务动作只使用内置 `wechatide-skill`、`wechatide.cmd` 和已注册 toolCall。
- 绝不调用旧版 `cli.bat`、`open/auto`、9420、`miniprogram-automator`、旧 daemon 或旧版 CDP 约定。
- 检测到旧版 NW.js 时立即停止，推荐改用 `$wechat-devtools-nwjs`；不得在本 Skill 中回退或混用旧版命令。
- 不修改安装目录中的官方 Skill，不把官方 Skill 整包复制进本 Skill，也不编造兼容层、工具名或参数。
- 将安装目录中的官方 Skill、所选 scene 和 `wechatide-tools/references/tools.yaml` 视为当前版本的唯一事实来源；本文件只补充经过验证的隔离和启动安全约束。
- 区分 IDE 的启动外壳与自动化能力：普通 GUI 和 `--cli` 外壳都可承载 toolCall。已导入项目可由官方传统 CLI 形成单项目 `cli-automation` 冷启动；自动化依赖 MCP 授权服务、项目运行时与 Automator/Debugger，不是 `--cli` 参数本身。
- 本 Skill 的所有本地辅助逻辑只使用无第三方依赖的 Node.js `.mjs`，Windows 与 macOS 调用同一脚本。不要新增或依赖 `.ps1`、`.bat`、`.sh` 业务包装器；安装包自带的 `.cmd` 只作为微信官方入口。

## 官方来源与渐进加载

按平台定位官方入口：Windows 默认使用 `C:\Program Files (x86)\Tencent\WechatTool\wechatide.cmd`，macOS 默认使用 `/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide`。将同一安装版本内包含官方根 `SKILL.md` 的目录记为 `<official-skill-root>`。默认位置不存在时运行 `<official-skill-root>/skills/installer/scripts/check-installation.mjs`，使用其返回的绝对命令和安装根目录。

下列 `references/...`、`skills/...` 和 `wechatide-tools/...` 均相对于 `<official-skill-root>`，不是本 Skill 的本地文件。官方 scene 决定工具、参数、授权、异步任务与失败处理；本 Skill 的本地 SOP 只补充已验证的启动隔离、运行时恢复和证据判定，不替代官方能力。

按任务加载官方内容：

- 总是完整读取 `<official-skill-root>/SKILL.md` 和当前主 scene 的 `SKILL.md`。
- 首次调用 toolCall 前读取 `<official-skill-root>/references/environment-readiness.md`。
- 只有返回 `pending` 时读取 `<official-skill-root>/references/async-task-polling.md`。
- 只有涉及写入、确认或高影响动作时读取 `<official-skill-root>/references/approval-policy.md`。
- 只有共享工具归属、工具名或 scene 不明确时读取 `<official-skill-root>/references/tool-index.md`。
- 只有出现项目路径、配置或 AppID 错误时读取 `<official-skill-root>/wechatide-tools/references/project-tool-error-guide.md`。
- 只有从零创建项目时读取 `<official-skill-root>/wechatide-tools/references/create-project-guide.md`。
- 只有需要确认参数时查询 `<official-skill-root>/wechatide-tools/references/tools.yaml` 的单个工具条目或运行 `<tool> --help`。

不要复制完整官方 Skill/注册表，不把全部工具注册为常驻 MCP 上下文。官方入口、根 Skill 或注册表缺失时停止，不回退旧版工具。

## 调用约定

固定 clientName 为 `Agent`，同一会话内不得变化。将官方检测结果中的绝对命令路径记为 `<wechatide>`，在当前平台 shell 中按参数数组安全调用：

```text
<wechatide> -c Agent check_wechatide_status --skill-version <skillVersion>
<wechatide> -c Agent <registered_tool> <official_flags>
```

所有路径参数使用本地绝对路径。令牌、版本关系、登录门禁和写操作确认完全遵循已安装官方 Skill；不得猜测 token、从安装目录翻找 token 或在回复中复述完整 token。

## 执行流程

1. 识别当前平台、官方入口和用户主目标。
2. 任务涉及打开、关闭、冷启动、附着或项目窗口时，完整读取 [启动与附着 SOP](references/startup-and-attach-sop.md)。
3. 首次 toolCall 前用 clientName `Agent` 执行官方状态门禁；只在版本、登录和 token 条件通过后继续。
4. 选择一个官方主 scene，按其说明调用注册工具；跨 scene 时携带项目路径、已确认事实、blocker 和 pendingTask。
5. 页面空白、Automator timeout、自定义组件、遮罩或小程序业务登录异常时，完整读取 [自动化运行时 SOP](references/automation-runtime-sop.md)。
6. 任务需要请求/响应证据时，完整读取 [Network 取证](references/network-evidence.md)。

硬约束：不循环开窗、授权、刷新或开页；不自动关闭未知项目；不把进程、窗口、编译成功或非空 `currentPage` 单独视为完整成功。

## 场景路由

按官方根 Skill 选择一个主 scene，并完整读取 `<official-skill-root>/skills/<scene>/SKILL.md`：

- 状态、登录、项目窗口、AppID、运行时：`initializer`
- 项目列表、导入、移除、代码片段：`project-manager`
- 本地 `project.config.json`：`project-config`
- 编译页面、构建 npm、刷新模拟器：`compiler`
- 预览、二维码、上传体验版：`previewer`
- 点击、输入、滚动、断言、脚本：`automator`
- console、network、截图、运行时取证：`debugger`
- 云环境、云函数、数据库、存储：`cloudbase-operator`
- 安装、更新或入口诊断：`installer`

从零创建项目使用官方 `create-project-guide.md`，不是独立 scene；地图组件或腾讯位置服务只在相关任务中读取官方 `references/map-skill-index.md`。跨 scene 时严格携带官方要求的 `project`、`confirmed`、`blocker` 和 `pendingTask`，不重复状态门禁或无故开窗。

常用工具包括 `check_wechatide_status`、`open_project_window`、`automation_runtime_info`、`automation_element_action`、`simulator_refresh`、`get_simulator_console`、`get_simulator_network`、`login` 和 `polling_task_result`。调用前仍须从当前安装版本确认名称、scene 与参数。

## 结果报告

按任务逐层报告已确认状态，不跨层推断：`platform`、`launchMode`、MCP/授权、项目元数据、目标窗口、编译、模拟器运行时、debugger、真实业务 network。始终报告实际绝对项目路径、使用的官方工具、未确认层级和 blocker。
