# 自动化运行时 SOP

项目窗口已确认打开后，遇到页面空白、Automator 超时、自定义组件阻断、业务登录缺失或遮罩时完整读取本文。启动、项目导入和单窗口控制见 [启动与附着 SOP](startup-and-attach-sop.md)；请求/响应证据见 [Network 取证](network-evidence.md)。

## 开窗后就绪检查

1. 调用项目作用域的 `automation_runtime_info` 获取 `currentPage` 或 `pageStack`。超时表示运行时尚未可用，不等于项目未打开；非空页面也不等于完整 IDE 已成功。
2. 使用 `simulator_screenshot` 区分正常页面、编译/加载态、空白页、授权弹窗、教程遮罩和调试器错误。
3. 任务需要 debugger 时，至少成功调用一个对应的官方 debugger 工具，不用页栈替代 debugger 证据。
4. 检查 console 中的 `appid missing` / `APPID_ERROR`，并确认 network 出现目标项目的非 `SdkReport` 请求。只有 `SdkReport` 不代表业务运行时就绪。
5. CLI 外壳不显示完整路径时，仍报告用户请求的绝对项目路径，并以项目作用域运行时、debugger 或只读文件监听证据复核。

## 空白页与 Automator 超时

1. 先取页栈、截图、相关 console 和目标 network 记录，不盲目增加 selector 等待。
2. 出现 `appid missing` / `APPID_ERROR` 时，只读核对 `project.config.json` AppID、`get_user_appids` 权限和 `project_list` 导入元数据。项目未导入或元数据不一致时停止运行时恢复，返回启动 SOP 处理；不要在本阶段循环关窗、导入或重开。
3. 项目元数据和账号权限正确但模拟器空白/僵死时，最多调用一次 `simulator_refresh`。工具成功只表示刷新已触发。
4. 刷新后重新取页栈、截图、console/network 和目标元素。刷新可能清空旧缓冲，空缓冲不能证明问题已消失；截图也返回 `waitForAutomatorReady timeout` 时不循环截图。
5. 刷新后仍无运行时，且存在来自用户目标、`app.json` 或已确认页栈的安全页面路径时，最多调用一次 `simulator_open_page`。
6. 打开页面后仍无运行时时停止；不继续刷新、开页、重开窗口、清缓存或修改 AppID。

## 小程序业务登录

- 分开判断 MCP 客户端授权、IDE 账号登录和小程序业务登录。`check_wechatide_status.tokenRequired` 是 CLI 访问令牌门禁；业务请求中的空 `Access-Token` 通常属于小程序自身登录状态。
- 页面已加载但列表为空、目标请求未发出或业务 token 为空时，只读确认业务登录状态；不要调用 `wechatide auth/login` 冒充小程序登录。
- 只走小程序可见的正常登录入口。需要扫码、手机号授权或用户确认时暂停并提示；禁止读取、复制、猜测或迁移其它 IDE/运行时中的 token。

## 自定义组件与选择器

1. 先用 `automation_page_action --action querySelectorAll` 查找可见元素，再执行一次 `automation_element_action`。工具返回 `success` 后，用路由、页栈、截图、文本或 modal 验证 postcondition。
2. 第一次查询为空或第一次 `waitForSelector` 超时后，停止重复同类 selector。只读查看当前页 WXML、页面 JSON、`usingComponents` 和直接子组件 WXML，定位组件边界。
3. 区分读取与真实点击：
   - 读取数据可使用官方 `automation_evaluate` 做受控只读读取。
   - 真实点击不得用 evaluate 调内部 handler、改 `setData` 或伪造事件。selector 不可达时，报告 tap 未完成；只有用户目标允许且页面代码给出已确认路由时，才使用 `automation_navigate`，并明确记录为 `navigate`。
4. 读取封装组件数据时，从 `getCurrentPages()` 获取当前页，优先通过宿主 WXML 的明确 class/id 选择直接子组件；按需读取 `$scope.is`、`$scope.data`、`selectAllComponents(...)` 或 `$vm.$children` 中与任务相关的非敏感字段。
5. `$vm`、`$scope` 和编译字段属于不稳定实现细节，只作为已确认的最后只读回退。字段被压缩或混淆时，必须用 WXML、页面可见文本或路由行为交叉验证；结构不匹配时停止，不猜测业务含义。
6. 禁止用 evaluate 查找或输出令牌、修改业务状态、规避授权或执行无关代码。

## 遮罩、modal 与页面恢复

- tap 成功但路由未变化时，立即取截图或查询可见 modal，区分业务弹窗、遮罩和动作无效。
- 业务登录弹窗不是 MCP 授权弹窗；不得用 MCP token、`auth` 或 `login` 代替业务登录。
- 有稳定 selector 时只关闭一次；selector 被组件边界阻断时，不用坐标猜点，也不用 evaluate 调内部关闭方法。
- 不把 `reLaunch` 当作通用关闭 modal 或恢复页面的手段。确需使用时，路由必须来自用户目标或已确认页面配置，并在执行后重新验证当前页。
- 无法安全关闭但存在已确认的替代路径时，可用官方导航继续并记录恢复方式；否则停止并报告 blocker。

## 结果与停止条件

记录当前页、截图状态、自动化方式（`tap` / `navigate` / `evaluate-read`）、业务登录、debugger/network 证据、postcondition 和未确认项。

以下情况停止自动恢复：一次 refresh 加一次已确认页面 open 后仍无运行时；需要修改 AppID 或清缓存；项目导入元数据不一致；自定义组件要求真实点击但 selector 不可达；需要人工业务登录；只有 `SdkReport` 或目标请求仍未出现。
