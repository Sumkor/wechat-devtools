# 启动与附着 SOP

需要打开、冷启动、附着、切换或关闭项目窗口时完整读取本文。

## 平台入口

- Windows toolCall：`<install-root>\wechatide.cmd`
- Windows 单项目冷启动：`<install-root>\wechatidecli.cmd open --project <absolute-path>`
- macOS toolCall：`<app-root>/Contents/MacOS/wechatide`
- macOS 冷启动：`open -a <resolved-app-root>`，不传项目或 `--cli` 参数
- 默认位置不存在时运行官方 `skills/installer/scripts/check-installation.mjs`，使用返回的绝对命令和安装根目录；不要另写平台探测脚本。

Windows 传统 CLI 单项目冷启动已经实测；macOS 不假设存在 `wechatidecli`，走普通 GUI 与官方 toolCall 状态机。

## 启动前置

1. 只读检查没有 IDE 父进程的桌面根进程；子进程数量不等于 IDE 实例数量。
2. IDE 已运行时优先附着，不再启动第二个根进程。
3. 传统 CLI 冷启动前确认目标已在 `project_list`，且有正确 `appId`、`compileType`。未知或未导入时，先在可用 IDE 会话执行一次 `project_import`。
4. 不直接运行 `微信开发者工具.exe --project ...`，也不先启动 EXE 再调用 `open_project_window`。
5. 固定 clientName 为 `Agent`，显式启动外壳后再执行授权与状态门禁；不要让首个业务 toolCall 隐式冷启动。

## 启动分流

- Windows、IDE 已关闭、目标已导入：只执行一次 `wechatidecli.cmd open --project <absolute-path>`，记录 `launchMode: cli-automation`；之后不再调用 `open_project_window`。
- macOS 或用户要求普通 GUI：无参数启动桌面程序，记录 `launchMode: normal-gui`；普通 GUI 可能自动恢复上次项目。
- IDE 已运行：记录现有外壳模式，先探测目标和候选项目的运行时，不执行新启动。

`fullMode` 只控制窗口内容，不会把 `--cli` 外壳变成普通 GUI，也不保证界面显示完整项目路径。

## 项目状态机

对目标绝对路径和文件监听给出的候选路径调用项目作用域的 `automation_runtime_info`：

- `shell-ready`：只有一个桌面根进程，`check_wechatide_status` 通过；Windows CLI 还应只有目标监听候选。
- `runtime-ready`：返回 `currentPage`、`pageStack` 或 `systemInfo`；直接附着。
- `starting`：返回 Automator timeout、编译/加载中证据或已有监听但尚无运行时；只读轮询。
- `absent`：官方项目作用域工具明确表示未打开，且无冲突证据。
- `ambiguous`：多路径成功、证据冲突或无法归属；停止窗口变更。

轮询以状态为退出条件，不以固定等待时间为准。窗口出现、CLI 退出码、标题、单个文件监听或非空 `currentPage` 均不能单独证明完整启动。

## 单窗口规则

1. `runtime-ready` 时不调用 `open_project_window`。
2. Windows CLI 已发送目标 `OPEN` 后不调用 `open_project_window`。
3. 普通 GUI 模式仅当目标和其它候选路径都明确为 `absent` 时，调用一次 `open_project_window`。
4. 其它项目为 `starting` 或 `runtime-ready` 时不打开目标，也不自动关闭。报告确切路径，取得用户针对该路径的关闭确认后再调用一次 `close_project_window`。
5. 关闭后必须重新确认该路径为 `absent`；状态不明确时不继续开窗。
6. 不用关闭重开作为探测手段，不循环启动、开窗或授权。

## 传输恢复

最后一个 CLI 项目窗口关闭后，toolCall 服务可能退出。后续开窗返回 `CONNECT_ERROR` 时：

1. 不重发开窗。
2. 显式执行一次 `<wechatide> auth -c Agent`。
3. `success` 后只重试原开窗一次；`pending` 按官方异步规则轮询。
4. 再次失败即停止，记录 `transportRecovery: explicit-auth-once`。

## 成功证据与停止条件

逐层确认：启动模式、MCP/授权、项目元数据、目标窗口、运行时、debugger 和真实业务 network。传统 CLI 用单根进程、唯一目标监听、目标运行时和 debugger 证据确认；普通 GUI 新开用官方开窗结果确认。

以下情况停止：`ambiguous`；安全观察上限后仍为 `starting`；需要关闭但未获确切路径确认；显式授权后单次重试仍失败；未导入项目出现 `appid missing`；出现第二个根进程或第二个项目监听路径。

Windows 已验证案例：目标提前导入后，`wechatidecli.cmd open --project <path>` 只建立一个根进程和目标窗口，并建立 `pages/creator/index` 运行时。该证据不外推到 macOS，也不证明业务登录或目标接口成功。
