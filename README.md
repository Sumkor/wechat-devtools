# wechat-devtools Skill

让具备命令行权限的 AI Agent 直接操作微信小程序，完成页面跳转、点击输入、滑动滚动、截图、断言和接口排查。

它基于微信官方 `miniprogram-automator`，不需要配置 MCP Server，也不会让 AI 在每次操作时临时编写 JavaScript。

## 为什么做这个 Skill

目前常见的微信小程序 AI 自动化方案主要有两类问题：

- [wechat-devtools-mcp](https://github.com/WaterTian/wechat-devtools-mcp) 使用少量聚合工具，比较节省上下文，但没有充分暴露原始 Automator 能力。复杂滑动、触摸和 scroll-view 精确滚动等操作容易受限。
- [weapp-agent-mcp](https://github.com/Chaixueyuan/weapp-agent-mcp) 覆盖能力更完整，但一次性注册 40 多个 MCP 工具，工具说明和参数会长期占用大量上下文。

本 Skill 采用折中方案：

- 常用操作提供稳定的 Node CLI 命令。
- 不常用的官方能力通过受控 `invoke` 按需调用。
- 详细说明按需读取，不一次性塞入上下文。
- 使用常驻 daemon 复用连接，连续操作更稳定。

## 主要亮点

### 一条命令稳定启动项目

只需提供项目路径，Skill 会按阶段完成：

```text
阶段 1：检查并准备微信开发者工具
阶段 2：打开项目，确认窗口持续稳定
阶段 3：开启自动化并等待编译完成
阶段 4：建立连接并确认页面可操作
```

启动流程重点解决实际使用中的常见问题：

- 默认只打开一个微信开发者工具，避免重复窗口。
- 等项目稳定后再开启自动化，避免项目刚打开就退出。
- 启动中断或编译较慢时按实际状态恢复，避免从头重复操作。
- 只有页面真正可操作时才报告启动完成。
- 已经手动打开项目时，可以直接连接当前窗口，无需重新启动。

### 不依赖 MCP

只要 Agent 可以执行 shell，就能使用本 Skill。无需配置 `mcpServers`，也没有几十个 MCP tools 长期占用上下文。

### 使用微信官方自动化能力

所有页面和元素操作都通过官方 `miniprogram-automator` 完成，不使用模拟鼠标坐标点击等非官方控制方式。

### 支持完整手势

同时支持：

- 页面或元素 swipe
- 真实触摸序列
- `scroll-view` 精确滚动到指定 x/y 位置

swipe 和 scroll-view 滚动是两种不同能力，本 Skill 不会混用。

### 关注关键接口请求

默认支持通过 CDP 观察页面请求。搜索、提交、进入详情等关键动作后，可以读取请求参数和响应数据，用于：

- 获取数据 ID 等下一步操作参数
- 判断接口是否成功
- 排查页面数据异常
- 保存自动化测试证据

### 输出适合 AI 阅读

CLI 返回紧凑 JSON，并支持限制数量、读取局部 data、投影响应字段，避免把完整页面树或大段接口响应塞进上下文。

## 适合什么场景

- 让 Codex、Claude Code 等 Agent 操作微信小程序
- 自动执行搜索、列表、详情、表单等业务流程
- 测试 swipe、scroll-view 和复杂页面交互
- 获取页面关键请求和响应 ID
- 执行截图和页面断言
- 希望减少 MCP 工具对上下文的占用

## 安装

运行环境：

- Windows 或 macOS
- Node.js
- 微信开发者工具
- 微信开发者工具 CLI；Skill 会按系统识别默认安装位置，也支持通过参数或环境变量覆盖

首次使用时，在 Skill 目录执行：

```shell
npm install
node .\scripts\weapp-auto.js env check --project '<miniapp-path>'
```

发布版不需要携带 `node_modules`，目标机器首次使用时安装依赖即可。

## 快速开始

```shell
node .\scripts\weapp-auto.js session start --project '<miniapp-path>'
node .\scripts\weapp-auto.js page current
node .\scripts\weapp-auto.js element tap --selector '.submit'
```

`session start` 负责协调各阶段，但每个阶段都会独立确认结果：

```text
准备开发者工具
  -> 打开并稳定项目
  -> 构建并启动自动化
  -> 连接并确认页面
```

某一阶段失败时，Skill 应从该阶段继续恢复。例如项目已经打开，就不再重启开发者工具；项目已经构建，就只建立自动化连接。

### Attach 手动打开的 IDE

若用户已经手动启动微信开发者工具并打开项目，可以保留当前窗口并直接连接：

```shell
node .\scripts\weapp-auto.js session start `
  --project '<miniapp-path>' --no-cdp
```

这种方式适合继续操作已经打开的项目。若还需要接口抓包，建议使用默认启动方式。

### 常用操作

```shell
# 点击和输入
node .\scripts\weapp-auto.js element tap --selector '.submit'
node .\scripts\weapp-auto.js element input --selector 'input' --value '沙发'

# 滑动和精确滚动
node .\scripts\weapp-auto.js gesture swipe --selector '.list' --direction up
node .\scripts\weapp-auto.js scroll-view to --selector '.list' --x 0 --y 800

# 断言和截图
node .\scripts\weapp-auto.js assert visible --selector '.result'
node .\scripts\weapp-auto.js page screenshot --path '.\tmp\result.png'

# 观察关键请求
node .\scripts\weapp-auto.js network clear
node .\scripts\weapp-auto.js network list --type XHR --limit 20
```

## 能力概览

- 启动、连接、状态检查和恢复
- 页面栈、当前路由、页面 data
- 页面导航和等待条件
- 元素查询、点击、按文本点击和输入
- swipe、触摸和 scroll-view 滚动
- screenshot
- visible、text、data、path 断言
- page `setData`、page/element `callMethod`
- `callWxMethod`、Mock 和恢复 wx 方法
- CDP 请求列表、详情和响应体读取
- 受控 `invoke` 和能力查询

## 使用原则

- 同一个实例内的操作必须串行执行。
- 不使用固定长时间 sleep，优先等待路由、元素或请求条件。
- 页面关键操作前清空网络记录，操作后关注对应请求。
- 请求成功不等于页面正确，仍需检查路由、元素、data 或截图。

## 详细文档

- [Skill 使用入口](SKILL.md)
- [业务操作 SOP](references/business-automation-sop.md)
- [命令与会话](references/commands-and-sop.md)
- [启动与故障诊断](references/diagnostics.md)
- [网络请求采集](references/network-capture.md)
- [手势与选择器](references/gestures-and-selectors.md)
- [断言与 invoke](references/assertions-and-invoke.md)
- [能力覆盖说明](references/capability-coverage.md)

## License

本 Skill 使用 [MIT License](LICENSE)。
