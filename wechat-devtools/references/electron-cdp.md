# Electron 标准 CDP

任务需要捕获页面真实请求、完整响应体、Console 或区分 IDE/模拟器/WebView target 时完整读取本文。

## 架构与边界

现代 Electron 与旧 NW.js 在业务自动化的核心组合上可以采用同一思路：

```text
9420 -> miniprogram-automator -> 页面导航、查询、输入、点击和断言
CDP  -> Electron Chromium    -> target 枚举、Network、Console 和响应体
```

Electron 还提供官方 `wechatide-skill` + toolCall，适合项目管理、编译、模拟器截图及官方调试辅助；它不替代当前 npm 9420 会话，也不要把官方 toolCall 的页面实例或登录态冒充为 npm 会话。

标准 Electron CDP 来自主进程启动参数 `--remote-debugging-port=<port>`，通过 `http://127.0.0.1:<port>/json/list` 枚举 target。它不同于 9420 内部 `App.CDP*` inspectee：后者通常没有 `Target`/`Browser` 域，不能枚举整个 Electron 实例。

CDP 能操作某个 target，不代表可以控制所有微信原生界面。IDE BrowserWindow、pageframe、逻辑层和 WebView 可能是 CDP target；系统级授权面或原生 surface 可能不是。必须记录实际发出请求的 target 类型、标题和 URL，不能只因 `/json/list` 可访问就宣称目标能力成立。

## 安全启用

1. 新启动现代 Electron 时默认同时启用标准 CDP；只有用户明确要求无 CDP 时才跳过。
2. 已有 IDE 同时具备可用 9420 和标准 CDP 时直接复用，不执行第二次 `auto`。
3. 当前 IDE 没有标准 CDP 时继续复用 9420 并报告能力缺口；只有用户允许关闭/重启后，才以同一个 Electron 根进程加入 `--remote-debugging-port`。不能在运行中的 Chromium 实例上事后补开该端口。
4. 默认优先使用 `9222`，被占用时只在 `9223..9232` 中选择空闲端口；显式指定端口失败时停止。启动后验证 `/json/list`，并核对端口所属进程确为本次微信开发者工具，而不是 Chrome 或其它 Electron 应用。
5. 只绑定 loopback。禁止使用 `0.0.0.0`、局域网地址或公网暴露调试端口。
6. 保持一个 IDE 根实例、一个目标项目和一个 9420。不要为了 CDP 另开第二个项目窗口或第二套 Automator 会话。
7. CDP 属于默认运行能力，正常任务结束时保持 IDE 当前状态；不要仅为了关闭 CDP 再次重启。只有用户要求回到无 CDP 模式时才受控重启。

安装入口和具体启动参数必须以当前安装包为准，见 [启动与附着 SOP](startup-and-attach-sop.md)。不要复制 NW.js 的 `cli.bat`、daemon、IDE HTTP 回调端口或启动顺序。

## target 枚举

使用通用脚本只读列出可附着 target：

```sh
node <skill-root>/scripts/capture-cdp-network.mjs --cdp-port 9222 --list-targets
```

常见 target 包括 IDE BrowserWindow、`page`/pageframe、小程序逻辑层 `webview`、WebView 页面、worker 和 DevTools 自身。脚本默认排除 `devtools://` 与扩展页面，并只附着带 `webSocketDebuggerUrl` 的候选 target。

如果多个 target 标题相近，不要凭标题猜归属。先同时监听候选 target，再根据真正产生目标 URL 的记录确认逻辑层或 WebView 归属。

## 捕获页面真实响应

监听必须先于业务动作启动：

```sh
node <skill-root>/scripts/capture-cdp-network.mjs \
  --cdp-port 9222 \
  --url-contains /api/detail \
  --method POST \
  --duration-ms 30000 \
  --output ./artifacts/detail-response.json
```

脚本输出 `event: ready` 后，再由另一个 Automator 脚本在同一 9420 会话执行一次目标点击或导航。脚本会：

1. 从 `/json/list` 枚举并附着候选 target。
2. 对每个可用 target 调用 `Network.enable`。
3. 捕获期间继续发现导航后新建的 target，并按 URL 和 method 匹配页面实际产生的请求。
4. 等待 `responseReceived` 与 `loadingFinished`。
5. 在原 target 调用 `Network.getResponseBody`。
6. 记录 target、请求元信息、状态码、协议、MIME 和脱敏响应体。

这属于监听页面真实流量，不是 Node `fetch`、`callWxMethod('request')` 或复制请求后的重放。若动作在监听器 ready 前已经完成，不能补回历史响应。

## 推荐确认链

围绕每个关键业务动作保留一条紧凑证据链：

1. 启动带 URL/method 过滤的 CDP 监听并等到 ready。
2. 用 Automator 执行一次真实动作。
3. 确认目标路由或关键可见元素。
4. 确认 CDP 记录的 URL、method、status 和 target。
5. 只读取任务需要的响应字段。
6. 必要时保存最终截图。

请求成功不能替代页面断言；页面出现也不能证明目标接口成功。两者应交叉验证。

## 数据最小化和限制

- 脚本默认脱敏 Authorization、Cookie、token、secret、ticket、手机号、登录/手机号 code 和精确经纬度等字段，并遮盖明显的手机号与 Bearer 值。
- 响应体默认最多保留 200 KB，最大允许 2 MB。二进制/base64 内容不直接输出。
- 默认忽略 `data:`、`blob:`、DevTools/扩展和 loopback 编译资源，避免把 IDE 内部噪声当成业务接口。
- URL query、请求头、POST data、响应头和 JSON 响应都会经过脱敏；仍应只保存任务必需字段，并在分享前复核产物。
- target 在读取响应体前断开时，可能只有元信息而没有 body。
- CDP 只能看到该 Electron 暴露给调试端口的 target；未暴露的原生通道、系统授权面或安装监听前已完成的请求不在覆盖范围内。
- 不并发使用多个脚本控制同一个 Automator 会话。CDP 可以同时监听多个 target，但页面动作仍保持串行。

## 回退顺序

标准 CDP 不可用时，依次考虑：

1. 官方 toolCall 的 simulator network，仅用于它自己的官方运行时。
2. 当前 npm 9420 会话的 `wx.request` 应用层包装器。
3. 用户明确授权的 loopback HTTP(S) 代理。
4. 页面/组件 data、路由、源码映射和视觉证据。

各路径的证据等级和覆盖差异见 [Network 取证](network-evidence.md)。
