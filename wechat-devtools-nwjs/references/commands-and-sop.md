# Commands And SOP

## 目标

用少量顶级命令覆盖会话、页面、元素、手势、断言和 escape hatch；CLI 输出紧凑 JSON，避免完整元素树进入上下文。

## 会话入口

## 兼容性门禁

先执行 `env check --project`。本 Skill 只拥有 NW.js 的 `cli.bat`、9420、`miniprogram-automator` 和本地 daemon 流程。

若输出为 `runtime: electron` / `legacySupported: false`，立即停止并推荐 `$wechat-devtools`。不得继续检查 9420、执行 `open/auto`、启动旧 daemon，或在本 Skill 内调用 `wechatide.cmd` / `wechatidecli.cmd`。

启动过程中始终区分四层状态：IDE 已启动、项目已打开、项目已构建、自动化运行中。具体判据与对应恢复动作见 [diagnostics.md](diagnostics.md)。只有 `currentPage` 返回非空路由后，才把会话视为可操作。

将启动视为四个可独立恢复的阶段：

1. 准备 IDE：确认进程和服务可用。
2. 打开项目：执行 open，并同时确认目标工程 target 存在、DOM 已完成加载、页面主体非空、可见初始化忙碌状态消失；全部信号保持约 3 秒防抖稳定后才进入 auto。任一信号退化、窗口消失或重建时重新判定。
3. 构建与开启自动化：执行 auto，等待运行页面和 9420。
4. Attach：连接 Automator，并取得有效 `currentPage`。

上一阶段未达到完成条件时不得进入下一阶段。某阶段失败后，从该阶段继续，不整组重放，也不重新启动已经可用的 IDE。

1. 已知目标项目时先执行：

```shell
node .\scripts\weapp-auto.js env check --project '<miniapp-path>'
```

2. 检查现有会话：

```shell
node .\scripts\weapp-auto.js session status
```

已连接且项目匹配时直接复用。

3. 未连接时以默认实例启动或复用会话：

```shell
node .\scripts\weapp-auto.js session start --project '<miniapp-path>'
```

4. 停止本 Skill 自己的 daemon，执行：

```shell
node .\scripts\weapp-auto.js session stop
```

`session stop` 只停止本地 daemon 及其连接，不关闭微信开发者工具。启动参数、状态分层和恢复流程统一见 [diagnostics.md](diagnostics.md)。

取消仍在进行的启动链但保留 daemon 和 IDE：

```shell
node .\scripts\weapp-auto.js session cancel
```

`session status` 和 `session cancel` 可绕过长任务队列立即执行。调用方等待被中断后，先 cancel，再检查状态，禁止直接发起另一次 start。

默认只使用 `default/9420`。启动失败时按 diagnostics 恢复，不切换实例或端口。

IDE HTTP 服务端口默认由启动回调动态识别；仅诊断或端口治理场景才显式传 `--ide-port <port>`。默认启动仍启用 CDP。

## 命令面

- `env check`
- `session start|status|cancel|stop`
- `network status|clear|list|wait|detail|body`
- `page current|stack|data|set-data|call-method|navigate|screenshot|wait`
- `element query|query-all|tap|tap-text|input|call-method|data`
- `gesture swipe`
- `scroll-view to`
- `wx call|mock|restore`
- `assert visible|text|data|path`
- `capability list`
- `invoke`

所有命令默认操作 `default` 实例。用户明确要求实例隔离时，按 [diagnostics.md](diagnostics.md) 的高级说明使用 `--instance`。

## 输出约定

- 成功统一返回 `ok: true` 或带结构化字段的对象。
- 断言失败返回 `ok: false`，CLI 退出码为 `1`。
- 普通错误退出码为 `2`。
- 不默认返回整页 data 或整页元素树；只有显式请求时才返回局部。

## 常见流程

操作真实业务前读取 [business-automation-sop.md](business-automation-sop.md)。

需要接口数据或故障证据时，先按 [network-capture.md](network-capture.md) 启动 CDP，再围绕关键操作执行 `network clear -> 页面操作 -> network wait/list -> network body`。

### 导航并等待结果页

```shell
node .\scripts\weapp-auto.js page navigate --method navigateTo --url '/pages/form/index'
node .\scripts\weapp-auto.js element tap --selector '.submit' --wait-route 'pages/result/index'
node .\scripts\weapp-auto.js assert visible --selector '.result-card'
```

### 读取局部 data

```shell
node .\scripts\weapp-auto.js page data --path 'form.status'
```

### 组件方法

```shell
node .\scripts\weapp-auto.js element call-method --selector 'set-tab-bar' --method navigateBack
```
