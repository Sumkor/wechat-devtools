# Diagnostics

## Electron 兼容性门禁

本 Skill 只诊断和执行旧版 NW.js 的 `cli.bat → open → auto → 9420 → miniprogram-automator` 流程。`env check` 会从安装结构识别 runtime：

- `runtime: nwjs` / `legacySupported: true`：继续以下旧版诊断。
- `runtime: electron` / `legacySupported: false`：立即停止并推荐 `$wechat-devtools`。此结果返回前不会探测 9420、CDP 或 IDE 服务端口，也不会启动旧 daemon、执行 `open/auto` 或调用任何现代命令。

## 启动状态模型

按以下四层状态逐级判断，不得用后一层动作的 CLI 退出码代替实际状态证据：

| 状态 | 必要证据 | 不足以证明该状态 |
|---|---|---|
| IDE 已启动 | 微信开发者工具主进程存在，且 IDE HTTP 服务端口或有效 CDP `/json/list` 可访问 | 只看到进程、项目选择页，或启动命令已返回 |
| 项目已打开 | CDP 中出现 `html/index.html?projectpath=...` 等与目标绝对路径匹配的工程 target，或已出现该项目运行 target | `cli open` 返回成功、启动参数包含 `--project`、最近项目列表出现项目卡片 |
| 项目已构建 | CDP 中稳定出现目标项目的 `appservice/mainframe` 与 `__pageframe__/instanceframe`，表明本次编译已产出可运行页面 | 构建面板开始输出、短暂 `about:blank`、`cli auto` 返回成功 |
| 自动化运行中 | 9420 连续稳定监听，daemon 已连接，且 Automator `currentPage` 返回非空路由 | 仅有 9420 监听、`connected=true` 但当前页为空 |

状态正常顺序为：`IDE 已启动 → 项目已打开 → 项目已构建 → 自动化运行中`。诊断和用户反馈必须报告当前最高已证实状态。例如，CDP 只有 `entrance.html` 时只能报告“IDE 已启动，项目未打开”；不得报告“项目正在编译”。项目选择 target 与工程 target 可以同时存在，不能因仍看到 `entrance.html` 就否定项目已经打开；应匹配目标工程 target 或运行 target。

恢复动作也按状态选择：

- IDE 未启动：执行一次完整 `session start`。
- IDE 已启动、项目未打开：使用实际 IDE HTTP 服务端口执行同实例 `open → auto`，不得再启动 IDE。
- 项目已打开、尚未构建：若本轮尚未执行 `auto`，执行一次；若已经执行，只观察构建和运行 target，不得重放 `open` 或 `auto`。
- 项目已构建、自动化未运行：继续观察 9420；本轮已经执行过 `auto` 时不得重试，只报告停在该阶段。
- 自动化运行中：停止所有启动和恢复动作，直接执行页面操作。

## 启动集成

本 Skill 已内置微信开发者工具启动能力，并由 `session start` 统一触发。

- 启动 9420 依赖微信开发者工具 CLI
- Windows 默认识别旧版 `C:\Program Files (x86)\Tencent\WechatTool\cli.bat`；批处理路径和项目参数由平台层做 `cmd.exe` 安全引用。macOS 默认识别微信开发者工具 `.app` 内的 CLI。两端都可用 `--wechat-cli` 或 `WECHAT_DEVTOOLS_CLI` 覆盖。
- 默认先以一次 IDE 进程启动同时准备 CDP 和 CLI 服务，再调用微信开发者工具 CLI 的 `--port <IDE服务端口> auto --project ... --auto-port 9420 --trust-project` 附着同一 IDE。`--port` 是全局参数，统一放在子命令之前，避免不同 CLI 版本对后置全局参数处理不一致。
- 支持显式项目路径和 CLI 路径覆盖
- 如果默认路径不存在，不要继续猜测其它安装位置；应让用户提供可用的微信开发者工具 CLI 路径
- 启动成功后再由 daemon 通过 `miniprogram-automator` 连接 `ws://127.0.0.1:9420`
- 已验证存在项目冷启动延迟：官方 CLI 输出成功后，开发者工具仍可能继续加载项目，9420 往往要再等待几秒到几十秒才开始监听
- 大型项目首次编译、切换环境或恢复 IDE 状态时可能需要数分钟；使用状态轮询和明确超时，不要用一次检查或固定长 sleep 判断失败
- `session start` 默认启用 CDP；不存在有效 CDP 实例时，会关闭旧 IDE，启动临时 CLI 回调服务，并以 `--cli --remote-port <callback> --enable-service-port --remote-debugging-port=<cdp>` 一次启动 IDE。IDE 回报实际 HTTP 服务端口后，CLI 使用显式 `--port` 附着并准备 9420，不应再次启动 IDE

一次启动的内部顺序：

1. daemon 在 `127.0.0.1` 分配临时 CLI 回调端口。
2. 仅启动一次 `微信开发者工具.exe`，同时传入 CDP、CLI 回调、服务端口启用和项目路径。不要直接给底层 `wechatdevtools.exe` 传相对路径 `.`；外层启动器会补充绝对 `code\\package.nw`，否则安装目录可能被误识别为扩展程序并报“清单文件缺失”。
3. IDE 请求 `/updatePort?port=<IDE HTTP port>`，daemon 取得实际服务端口并关闭临时回调服务。
4. IDE 回报服务端口后，直接在同一端口执行 CLI 的 `--port <IDE HTTP port> open`。不得因为这是本次新启动的 IDE 而先执行 `close`：主程序的 `--project` 可能已开始打开工程，此时 `close` 会把刚进入的项目立即关闭并退回项目选择页。
5. 轮询 CDP 并对目标工程 target 执行只读 DOM 检查。必须同时满足：target 与目标绝对路径匹配、`document.readyState=complete`、页面主体非空、没有可见的初始化 loading/spinner/skeleton/`aria-busy` 状态；同时用 DOM 结构指纹确认这些信号连续约 3 秒没有变化（最长等待 60 秒），再进入下一步。任一信号退化、target 消失或重建、DOM 结构继续变化时重新判定。这里等待的是 IDE 工程窗口就绪，不是 `appservice/pageframe`。
6. 执行 CLI 的 `--port <IDE HTTP port> auto --project ... --auto-port 9420`，由 auto 推进项目编译和运行初始化。不要在 auto 之前强制等待 `appservice/pageframe`：运行 WebView 要到 auto 后才出现。
7. `auto` 返回后轮询 CDP，直到同时出现 `appservice/mainframe` 和 `__pageframe__/instanceframe` target。构建面板开始输出或 target 暂时为 `about:blank` 都不代表运行态已经就绪。
8. `auto` 返回后使用本轮剩余超时持续等待运行 target。即使目标工程 target 暂时消失，也不得自动重新 `open` 或再次 `auto`；自动化初始化本身可能重建窗口，重放命令会中断正在进行的初始化。
9. 继续确认 9420 连续稳定监听。若本轮超时仍未稳定，停在当前阶段并报告证据，不得在同一启动链内重试 `auto`。稳定后才连接 daemon。

9420 开始监听不代表小程序运行元数据已经稳定。daemon 连接 Automator 时必须设置总超时，并轮询 `currentPage`；遇到连接悬挂、当前页为空或 `rawPath ... is null` 等初始化态错误时，在总超时内断开并重连。不得让一次未完成的 `automator.connect` 永久阻塞该实例的 daemon 队列。

若 CDP 仍在线，但 IDE HTTP 服务端口已经失效且 9420 也未监听，不能把该进程视为可复用会话。启动器会关闭这一残缺 IDE，并重新执行上述一次启动流程；不得让官方 CLI 自行再开第二个 IDE。

## 默认实例与一次启动

- 默认只操作 `default` 实例和 9420，不因系统中已有微信开发者工具进程而自动切换实例。
- 仅在用户明确要求同时保留多个项目时，才读取“高级实例隔离”章节。
- 默认启动的目标是最终只保留一个目标项目窗口。不要先手工打开项目再执行 `session start`，也不要在启动失败后调用 `open-other`。
- `session start` 默认启用 CDP；为补充 CDP 而受控重启现有无 CDP IDE，仍属于默认实例恢复，不应创建第二个项目实例。

推荐启动决策：

1. 已知项目路径时执行 `env check --project '<path>'`，一次确认项目、CLI、9420 和 CDP 状态。
2. 执行 `session status`。若 `connected=true` 且 `sessionInfo.projectPath` 与目标项目一致，直接复用，不再执行 `session start`。
3. 若 9420 已监听但 daemon 未连接，只执行一次 `session start --project '<path>'` 绑定现有端口。
4. 若 9420 和 CDP 都未就绪，执行一次普通 `session start --project '<path>'`，让命令统一负责 IDE、CDP、CLI auto 和 Automator 连接。会话启动默认超时上限为 120 秒；特别大的项目可显式提高到 `--timeout 180000`。
5. 启动命令返回错误后，先重新读取 `session status`、`env check --project '<path>'`。不要仅因 CLI 非零退出就判定 IDE 未启动。

## 半启动状态

出现下列现象时，视为同一次启动尚未收敛，而不是需要打开第二个 IDE：

- CLI 输出 `IDE may already started ... wait IDE port timeout`；
- `session status` 显示 CDP target 或目标项目页面，但 `connected=false`；
- 9222 已有效、业务页面已出现，但 9420 尚未监听；
- IDE 已回报 HTTP 服务端口，但 CLI 附着或 9420 初始化仍在进行；
- 首次 `session start` 报错后，开发者工具仍在继续加载或编译项目。

恢复顺序：

1. 短周期轮询 `env check --project '<path>'`，分别观察 CDP、9420，不手工重开 IDE。
2. 正常情况下 CLI 使用 IDE 回报的显式 `--port` 一次附着。若出现外层命令超时、`IDE may already started`、`#initialize-error` 或 `wait IDE port timeout`，只观察运行 target 与 9420 是否自行就绪；未就绪时结束本轮并报告，不在同一次命令内重试 auto。
3. 只有内部恢复仍失败时，调用方才重新检查 `session status` 和 `env check --project '<path>'`；再次启动前核对 `sessionInfo.projectPath`、`automatorPort=9420` 和当前路由，保持默认实例和端口。
4. 一旦 9420 已监听或 `connected=true`，立即停止启动重试。

启动结果的 `launchInfo.cliAttempts` 记录唯一一次 CLI auto 的成功或错误摘要。可恢复的 CLI 超时只有在 9420 已自行就绪时才视为成功，不再产生第二次 auto。

## 高频堵点与处置经验

1. **把临时回调端口当成 IDE 服务端口**：启动参数中的 `--remote-port` 只接收 `/updatePort` 回调；后续 CLI 必须使用 IDE 回报或 `.ide` 状态文件中的实际 HTTP 端口。端口不一致错误通常会直接给出当前实际端口。
2. **CLI 假成功**：`open`、`auto` 退出码为 0 只代表命令已受理。分别检查目标工程 target、运行 target、9420 和 `currentPage`，不要跨层推断。
3. **项目刚打开又被关闭**：直接启动已经传入 `--project` 时，不得追加 `close → open`；`close` 可能关闭正在进入的工程。
4. **项目选择页造成“闪退”错觉**：`entrance.html` 可以与项目工程窗口同时存在，并可能重新获得前台焦点。先检查 CDP target 和 IDE 进程，不要仅凭可见窗口判断项目退出。
5. **大型项目较长时间没有运行 target**：一次 `auto` 后持续观察本轮超时，不要因短时间内没有 target 而重复 `open` 或 `auto`。
6. **用户中断等待后留下后台请求**：立即执行 `session cancel`；该命令和 `session status` 不进入长任务队列。确认 `sessionStartInProgress=false` 后再恢复。不得并发发起新的 `session start`；只有 cancel 无法到达 daemon 时，才只终止 Skill 的 Node 进程并保留 IDE。
7. **9420 已就绪却继续启动**：一旦 9420 稳定监听，只启动或复用 daemon 进行连接，不再执行 IDE、open 或 auto 操作。
8. **全局参数放在子命令之后行为不稳定**：统一使用 `CLI --port <IDE端口> open|auto|close`。即使后置 `--port` 返回成功，也不能假定所有开发者工具版本行为一致。
9. **open 后过早 auto 触发初始化竞态**：不要把固定 sleep 当成主要判据。使用“目标 target + DOM complete + 页面非空 + 无可见忙碌状态 + DOM 指纹稳定”的组合屏障，并仅做约 3 秒防抖。未越过屏障时不执行 auto；任一信号退化、target 消失或重建时重新判定，不要用 auto 尝试补救。

定位或恢复启动问题时严格分步执行：`准备 IDE → open → 等待工程稳定 → auto → 等待运行 target/9420 → attach Automator`。每一步记录证据，只有当前阶段完成才进入下一步。失败后从当前阶段恢复，禁止整组重放。

## 覆盖优先级

1. CLI 参数：`--project`、`--auto-port`、`--wechat-cli`、`--cdp-port`、`--ide-port`
2. 环境变量：`WEAPP_AUTO_PROJECT`、`WEAPP_AUTO_PORT`、`WECHAT_DEVTOOLS_CLI`、`WEAPP_CDP_PORT`、`WEAPP_IDE_PORT`
3. Skill 内部默认启动配置

## 高级实例隔离

仅当用户明确要求同时保留多个项目时使用；普通任务跳过本节，启动失败也不要切换实例。

```shell
node .\scripts\weapp-auto.js session start `
  --instance app-b `
  --multi-open `
  --project '<second-miniapp-path>' `
  --auto-port 9421 `
  --cdp-port 9222
```

- 为附加项目使用唯一 `--instance` 和未占用的 942x `--auto-port`。
- 后续命令保持相同实例名；同一实例内仍须串行。
- CDP 可复用主实例实际使用的端口；共享抓包时按 URL、参数和业务 ID 判断请求归属。
- `session stop --instance app-b` 只停止该实例 daemon。

## 诊断命令

```shell
node .\scripts\weapp-auto.js env check
```

重点看：

- `instance`、`daemonPipe`
- `projectConfigFound`
- `wechatCliFound`
- `automatorPortListening`

若 `wechatCliFound=false`，停止自动启动并要求用户提供微信开发者工具 CLI 的实际路径。

## 9420 与其它端口

- `9420`：Automator WebSocket 端口，`miniprogram-automator` 通过 `ws://127.0.0.1:9420` 连接。
- `9222`（可覆盖）：CDP HTTP/WebSocket 入口。必须确认 `http://127.0.0.1:9222/json/list` 返回 target；仅有 TCP 监听不代表 CDP 有效。
- IDE HTTP 服务端口：由 IDE 启动后通过 CLI 回调动态报告，也可用 `--ide-port` 显式指定；随后传给官方 CLI 的全局 `--port`。
- 临时 CLI 回调端口：由系统动态分配，只在 IDE 启动阶段接收 `/updatePort?port=...`，取得 IDE 服务端口后立即关闭。
- DevTools CLI 本体：由平台对应的 CLI `auto ...` 准备自动化，不等同于 9420。
- daemon IPC：Windows 使用 Named Pipe，macOS 使用 Unix Domain Socket；两者都不是微信开发者工具端口。

CDP 端口由微信开发者工具主程序启动参数 `--remote-debugging-port` 开启，不是 `cli.bat --help` 公开参数。`session start` 默认启用 CDP；现有 IDE 无有效 CDP 时会被重启。使用 `--no-cdp` 可只启动 9420。

默认优先使用 9222。若该端口被非 CDP 服务占用，未显式指定端口时自动尝试 9223 至 9232；显式 `--cdp-port` 无效或被占用时直接报错。仅诊断特殊启动问题时使用 `--no-restart-ide-for-cdp`，此时没有现成 CDP 会话会直接失败。

## 故障恢复

1. `env check --project '<path>'` 确认项目根目录和微信开发者工具 CLI 路径存在。
2. 分别检查 daemon IPC、9420 和业务页。daemon 存活只说明本地服务可用；9420 监听只说明 Automator 入口可连接；页面仍可能正在编译或加载数据。
3. `session start` 超时或 CLI 初始化失败时按“半启动状态”分层判断：命令只执行一次 auto，并持续观察运行 target 与 9420。失败后检查 IDE、项目路径、CDP、9420 和 `launchInfo.cliAttempts`；不要在同一启动链内重放 open/auto，也不要切换实例。
4. 9420 已监听后停止启动重试。若提示 `No active session`，执行 `session start --project ...` 绑定现有端口，不要重复启动开发者工具。
5. Automator 命令超时不保证动作失败，也不保证 daemon 请求已取消。先检查 `page current`；若后续命令持续排队，确认没有其它 Agent 操作后恢复 daemon：

```shell
node .\scripts\weapp-auto.js session stop
node .\scripts\weapp-auto.js session start --project '<miniapp-path>'
```

`session stop` 只停止本地 daemon 及其连接，不关闭微信开发者工具。若停止命令本身也排队，可仅终止本 Skill 的 daemon 和残留 CLI 进程，再执行 `session start` 复用现有 9420。

恢复命名实例时，继续使用原实例名和端口，不要改回默认实例。

6. 若真实项目阻塞登录、IDE 状态或扫码，记录阻塞原因，不要伪报会话已就绪。
