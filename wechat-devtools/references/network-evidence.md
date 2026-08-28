# Network 取证

任务需要确认请求、接口响应或提取响应字段时完整读取本文。

## 能力边界

- 使用官方 `get_simulator_network` 读取模拟器 network 缓冲，不连接远程调试端口，也不直接调用 CDP。
- 记录可能包含 `HTTP_REQUEST`、`HTTP_RESPONSE`、状态码、headers 和 `detail.response`。
- `detail.response` 可能因二进制、流式、过大、刷新清空或未缓冲而缺失或截断；不能承诺完整响应体。
- `SdkReport` 只代表微信运行时上报，不能证明项目业务初始化或目标接口成功。
- 官方 `get_simulator_network` 只对应官方 toolCall 的内部运行时/AppID 会话；它不能直接读取独立 `cli.bat auto --auto-port 9420` + npm `miniprogram-automator` 会话。两套会话的 network 缓冲、页面实例和登录态彼此隔离。

## npm 9420 应用层捕获

npm `miniprogram-automator` 没有 Playwright 式 `page.on('response')` 或内置 Network 面板。无法使用同一 Electron 实例的 CDP/代理时，可在 npm 会话中先用 `exposeFunction` 注册回调，再用 `evaluate` 包装当前页面的 `wx.request`：

通用监听器位于 [scripts/capture-wx-request.mjs](../scripts/capture-wx-request.mjs)，不需要为每个项目临时生成探针。它从运行命令所在的自动化项目目录解析 `miniprogram-automator` 依赖：

```sh
node <skill-root>/scripts/capture-wx-request.mjs --duration-ms 30000 --output ./artifacts/network.json
```

脚本只附着和监听，不执行页面动作；需要捕获某个动作时，应先启动监听，再由另一个 Automator 脚本操作页面，或在同一 Node 进程中调用相同的包装逻辑。

```js
const records = []
await mp.exposeFunction('__automatorNetworkRecord', record => records.push(record))
await mp.evaluate(function () {
  if (wx.request.__automatorWrapped) return
  const originalRequest = wx.request
  wx.request = function (options = {}) {
    const startedAt = Date.now()
    const report = payload => void __automatorNetworkRecord({
      url: options.url,
      method: options.method || 'GET',
      requestData: options.data,
      elapsedMs: Date.now() - startedAt,
      ...payload,
    })
    return originalRequest.call(wx, {
      ...options,
      success(response) {
        report({ type: 'HTTP_RESPONSE', statusCode: response.statusCode, data: response.data })
        options.success?.(response)
      },
      fail(error) {
        report({ type: 'HTTP_ERROR', error: error.errMsg || String(error) })
        options.fail?.(error)
      },
    })
  }
  wx.request.__automatorWrapped = true
})
```

该路径已在当前 Electron 版和 `miniprogram-automator@0.12.1` 的 9420 独立会话中实测成功：包装器安装后能收到页面真实发出的请求及其 success/fail 回调响应，而不是 Node 侧重放的 `fetch`。证据只能证明“包装器安装之后、经过 `wx.request` 的应用层请求”；边界如下：

- 安装前已完成的请求无法补回；页面重建、`reLaunch`、重新编译或运行上下文重启后需重新安装。
- 只覆盖 `wx.request` 的应用层回调；不保证覆盖 `wx.uploadFile`、WebSocket、原生 SDK、图片/文件下载等通道，也不提供完整底层 headers、TLS、重定向或网络包证据。
- `uni.request` 只有在当前实现最终调用 `wx.request` 时才会被观察到。
- 记录中的响应体是运行时回调对象，可能被业务二次加工；需要全部网络包或安装前流量时，改用同一 Electron 实例的 CDP `Network.enable`/响应体读取或显式 HTTP(S) 代理。
- 按数据最小化原则保存和输出记录，避免 token、cookie、手机号等敏感字段。

## 查询与过滤

1. `--command` 使用简单的 `grep -in keyword` 或 `grep -n .`。Windows `.cmd` 桥接时避免未转义的 `|`、`&`；多关键字分开查询。
2. grep 输出是候选集合，可能夹带分隔符或相邻无关记录。只接受同时匹配预期 `type` 和 `detail.url` 的记录。
3. 需要确定性过滤时，将官方命令的结构化 stdout 直接传给跨平台 Node.js 脚本：

```sh
<official-cli> -c Agent get_simulator_network --project <absolute-project-path> --command "grep -in product/search" | node <skill-root>/scripts/select-network-records.mjs --url-contains /product/search --type HTTP_RESPONSE
```

Windows 与 macOS 都直接调用 `.mjs`；上面的管道使用当前 shell 的等价写法，核心过滤逻辑统一由 Node 脚本完成。不维护平台专用的 PowerShell、Bash、批处理或 Python 包装逻辑。Node 不可用时停止。

## 证据判定

- 验证 URL、类型、状态码和内容与目标动作一致；整段文本含关键字不等于其中每条记录都匹配。
- `matched: 0` 表示没有通过 URL/type 校验的记录，不等于接口返回空数据。
- 第一次没有命中时先确认目标动作是否发生、运行时是否仍在。用户任务允许时只触发目标动作一次，再查询一次；不循环刷新或重放。
- CLI 的结构化 stdout 与授权/连接 stderr 分开判断；`ok: true` 只表示该次 toolCall 成功，不证明页面或业务接口就绪。

## 数据最小化

- 最终只返回任务需要的响应字段。
- 不复述 token、cookie、完整 headers、手机号、精确位置或其它无关个人数据。
- 无法验证响应属于目标 URL 时丢弃，不用相邻记录补充或猜测。

## 成功与停止

业务取证成功必须命中目标 URL，并验证对应响应内容。只有空缓冲、`SdkReport`、无关定位请求、截断且无法校验的响应或过滤结果为零时，报告未确认并停止推断。
