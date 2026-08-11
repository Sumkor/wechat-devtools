# Network Capture

## 架构

同一个 daemon 维护两个通道：

```text
9420 -> miniprogram-automator -> 页面操作
CDP  -> Chromium Network     -> 请求、响应和运行时诊断
```

CDP 端口来自微信开发者工具底层 Chromium 的 `--remote-debugging-port`，不是微信 CLI 的公开参数。开启 CDP 后仍需调用平台对应的微信开发者工具 CLI `auto` 准备 9420。

## 启用方式

普通 `session start` 默认启用 CDP：

```shell
node .\scripts\weapp-auto.js session start `
  --project '<miniapp-path>' `
  --timeout 120000
```

`session start` 默认启用 CDP；只使用 Automator 时传入 `--no-cdp`。CDP 启动顺序、端口回退和 IDE 重启规则见 [diagnostics.md](diagnostics.md)。

## 关键操作观察

关键业务动作前清空缓存：

```shell
node .\scripts\weapp-auto.js network clear
```

执行点击、输入、搜索或导航后，等待已知接口：

```shell
node .\scripts\weapp-auto.js network wait --url '/search' --method POST --timeout 10000
```

未知接口名时，查看最近请求：

```shell
node .\scripts\weapp-auto.js network list --type XHR --limit 20
node .\scripts\weapp-auto.js network list --status 500 --limit 20
```

查看目标请求的脱敏请求头、POST data 和响应头：

```shell
node .\scripts\weapp-auto.js network detail --id '<target-id>:<request-id>'
```

列表只返回紧凑元信息。需要响应内容时，使用列表中的 `id`：

```shell
node .\scripts\weapp-auto.js network body --id '<target-id>:<request-id>' --max-bytes 200000
```

JSON 响应优先投影到所需字段，减少上下文：

```shell
node .\scripts\weapp-auto.js network body --id '<target-id>:<request-id>' --json-path 'data.records.0.id'
```

使用响应体中的 ID、分页游标、状态或错误信息辅助下一步操作。不要把抓包替代页面断言；请求成功后仍要确认路由、关键元素或 data。

## 排查顺序

1. `network status` 确认 CDP 已启用且至少连接一个候选 target。
2. `network clear` 建立本次动作的观察窗口。
3. 执行一个关键页面操作。
4. `network wait/list` 确认 URL、method、status、type。
5. 只对目标请求读取 `network body`。
6. 将接口结果与页面 data、路由和元素状态交叉验证。

如果右侧 Network 面板能看到请求但 Skill 抓不到，检查 `/json/list` 是否暴露对应逻辑层 target。不同微信开发者工具版本可能不对外暴露全部 `wx.request`；此时回退到页面/组件 data、源码映射或其它授权的网络诊断方式。

## 安全与限制

- daemon 默认最多保留 500 条请求，`network list` 最多返回 100 条。
- 默认忽略 `data:`、`blob:`、DevTools 扩展和 `127.0.0.1/localhost` 编译资源，只保留可用于业务分析的外部请求。
- `Authorization`、Cookie、token 等敏感请求头自动隐藏。
- POST data 截断保存；响应体默认最多返回 200 KB，可配置上限不超过 2 MB。
- 二进制或 base64 响应会标记 `base64Encoded`，不要无条件输出大文件。
- CDP target 断开后，历史请求元信息仍可查询，但可能无法再调用 `Network.getResponseBody`。
- 同一 Automator 实例保持串行操作，不要由多个 Agent 并发控制。
