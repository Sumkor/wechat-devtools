# 启动与附着 SOP

需要打开、冷启动、附着、切换或关闭项目窗口时完整读取本文。

## 平台入口

- 安装根未知：先完整读取 [安装根发现](install-root-discovery.md)。已能定位官方 installer 时优先使用其返回的绝对命令；installer 自身也无法定位时，Windows 才依次查询卸载注册表、快捷方式和有限候选目录。
- Windows toolCall：`<install-root>\wechatide.cmd`
- 单项目冷启动：仅在当前安装包明确提供并记录了对应 CLI 时使用 `<official-project-cli> open --project <absolute-path>`；不要假设入口名称。
- macOS toolCall：`<app-root>/Contents/MacOS/wechatide`
- macOS 冷启动：`open -a <resolved-app-root> --args --remote-debugging-port=<cdp-port>`；不把项目路径或 `--cli` 参数传给 `open`
- 官方 Skill 根已定位时运行 `skills/installer/scripts/check-installation.mjs`，使用返回的绝对命令、版本和安装根；发现阶段只做只读查询，不新增自定义启动包装器。

不同平台和版本的 CLI 能力不同。现代 npm 路径只需要一个可用的 `auto --project ... --auto-port ...` 入口和 9420 WebSocket；无法解析入口时使用普通 GUI/官方 toolCall 或要求用户提供路径。

## 启动前置

1. 只读检查没有 IDE 父进程的桌面根进程；子进程数量不等于 IDE 实例数量。
2. IDE 已运行时优先附着，不再启动第二个根进程。
3. 传统 CLI 冷启动前确认目标已在 `project_list`，且有正确 `appId`、`compileType`。未知或未导入时，先在可用 IDE 会话执行一次 `project_import`。
4. 不直接运行 `微信开发者工具.exe --project ...`。需要冷启动时，只通过已解析并验证的 Electron 桌面入口启动一次外壳并带默认 CDP 参数，再由当前安装包的正式项目/Automator 入口打开项目和准备 9420。
5. 固定 clientName 为 `Agent`，显式启动外壳后再执行授权与状态门禁；不要让首个业务 toolCall 隐式冷启动。

## 标准 CDP 启动门禁

现代 Electron 新启动默认在主进程加入 `--remote-debugging-port=<port>`，使 Automator 会话始终具备可用的 Network/Console 观察通道；只有用户明确要求无 CDP 时才跳过。这不是 9420 Automator 端口，也不是 9420 内部 `App.CDP*` inspectee。

1. 先检查已有 IDE 的进程参数和候选 `/json/list`。若现有 IDE 已有有效 endpoint，核对监听进程属于当前微信开发者工具根实例，并直接复用。
2. 不存在 IDE 根进程时，默认优先选择空闲 `9222`；如果被占用，从 `9223..9232` 中选择首个空闲端口并记录最终 `cdpPort`。用户显式指定端口时，该端口不可用就停止，不静默换端口。
3. 只有 TCP 监听不算有效 CDP；必须得到 JSON target 列表。若端口属于 Chrome、其它 Electron 或普通服务，不附着错误进程。
4. 已运行 IDE 没有标准 CDP 时，继续复用现有 9420，不为了默认 CDP 静默关闭、重启或启动第二个 IDE；报告 `cdpEnabled: false`。只有用户明确允许重启，才以同一个项目、同一个 9420 和默认 CDP 规则受控重启。
5. 新启动或获准重启时只创建一个 Electron 根实例，通过已验证桌面入口传入 `--remote-debugging-port=<cdpPort>`，再调用当前安装包实际提供的项目/Automator 入口准备项目和 9420。不要复制 NW.js 的 `cli.bat`、`--remote-port` 回调或 daemon 启动序列。
6. endpoint 只允许 `127.0.0.1`/`localhost`/`::1`，禁止暴露到局域网或公网。
7. 启动后分别验证 Electron 根进程、目标项目 target、运行 target、9420 和 `currentPage`，并记录 `cdpEnabled`、`cdpEndpoint`、`automatorEndpoint`。CDP 可用不能替代 Automator 就绪；9420 可用也不能证明 CDP 属于同一实例。

target 枚举、网络监听和结束清理见 [Electron 标准 CDP](electron-cdp.md)。

## 启动分流

- 当前平台存在已验证的项目 CLI、IDE 已关闭、目标已导入：先以默认 CDP 参数启动一次 Electron 外壳，再只执行一次该 CLI 的项目打开/Automator 命令，记录实际入口、`launchMode: cli-automation` 和 `cdpEndpoint`。
- 没有已验证项目 CLI 或用户要求普通 GUI：以默认 CDP 参数启动桌面程序，记录 `launchMode: normal-gui` 和 `cdpEndpoint`；普通 GUI 可能自动恢复上次项目。
- IDE 已运行：记录现有外壳模式，先探测目标和候选项目的运行时，不执行新启动。

`fullMode` 只控制窗口内容，不会把 `--cli` 外壳变成普通 GUI，也不保证界面显示完整项目路径。

## 项目状态机

对目标绝对路径和文件监听给出的候选路径调用项目作用域的 `automation_runtime_info`：

- `shell-ready`：只有一个桌面根进程，`check_wechatide_status` 通过；若使用 CLI，还应只有目标项目的监听候选。
- `runtime-ready`：返回 `currentPage`、`pageStack` 或 `systemInfo`；直接附着。
- `starting`：返回 Automator timeout、编译/加载中证据或已有监听但尚无运行时；只读轮询。
- `absent`：官方项目作用域工具明确表示未打开，且无冲突证据。
- `ambiguous`：多路径成功、证据冲突或无法归属；停止窗口变更。

轮询以状态为退出条件，不以固定等待时间为准。窗口出现、CLI 退出码、标题、单个文件监听或非空 `currentPage` 均不能单独证明完整启动。

## 单窗口规则

1. `runtime-ready` 时不调用 `open_project_window`。
2. CLI 已发送目标 `OPEN` 后不调用 `open_project_window`。
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

任何平台的单次 CLI/GUI 启动证据都只证明外壳或窗口层级；仍需用运行时、页面和业务 network 证据确认目标就绪。不要把某个平台的入口名称、进程数量或页面路径外推到其它版本。
