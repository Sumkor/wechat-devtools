# `getPhoneNumber` 能力边界

当小程序使用 `<button open-type="getPhoneNumber">` 时，按以下通用边界判断自动化能力；项目 selector、业务接口、storage key、运行结果和失败证据应写在业务测试仓库，不写入本 Skill。

## 成功语义

- `tap()` 成功只证明按钮动作已发送，不证明产生 `getPhoneNumber:ok`。
- 真实成功必须由可见授权流程产生微信临时手机号 `code`，并由业务侧继续验证登录请求、storage 和已登录页面。
- 禁止用 `trigger`、`dispatchEvent`、`callMethod`、`evaluate`、`setData` 或内部 handler 合成回调；禁止迁移其它会话的 token、cookie 或临时 code。

## 三种登录状态

| 状态 | 身份来源 | 主要作用 | 不代表什么 |
| --- | --- | --- | --- |
| 开发者工具登录 | IDE 中登录的微信开发者身份 | 校验项目权限，支持编译、预览、上传和真机调试 | 不代表模拟器存在可授权的小程序用户，也不提供业务 Token |
| 多账号调试测试账号 | 开发者工具“多账号调试”中单独添加的测试用户；由 `miniProgram.testAccounts()` 等接口读取 | 在本地模拟器中模拟小程序终端用户、openid 和授权场景 | 不会因开发者工具已登录而自动创建；通常属于虚拟测试身份，不等同于真实业务用户 |
| 小程序业务登录 | 小程序通过 `wx.login`、`getPhoneNumber` 和业务登录接口建立的应用账号 | 生成业务 storage/Token，并进入已登录页面 | 不等同于 IDE 登录或测试账号存在；必须按业务后置条件单独验证 |

微信将三种状态隔离，避免开发者工具直接把开发者本人的微信身份或手机号提供给正在调试的小程序。因此“IDE 已登录但 `testAccounts()` 返回空数组”是允许出现的正常组合，此时不能推断手机号授权可用。CLI/MCP 授权同样只控制工具访问，不属于上述任何一种业务身份。

## 本地模拟器与 Native

- 开发者工具登录、测试账号和小程序业务登录彼此独立。
- `miniProgram.testAccounts()` 和官方 `automation_testaccount --action list` 读取已添加的真实测试账号 `accountMap`；空数组不代表安装包没有内置虚拟账号，只代表该列表没有可返回账号。
- 内置虚拟账号“存在”不等于当前 9420 已激活该账号。必须从当前窗口的运行时证据确认实际测试用户，不能只凭启动参数或账号选择界面推断。
- 旧 npm Launcher 会传 `auto --auto-account <openid>`，但现代 Electron CLI 可能不再注册该选项并静默忽略。启动后必须核验实际用户；未核验时按普通开发者身份处理。
- 官方 `automation_testaccount` 当前公开动作只有 `list|getTicket|setTicket|refreshTicket`，没有选择或激活测试账号的动作。
- 当前窗口没有激活测试用户时，本地模拟器可能显示真实 `open-type` 按钮，但点击后没有手机号授权面或回调。
- `native().authorizeAllow()` 只操作已经存在的通用授权面；返回 `{}` 不能证明手机号授权发生，也不会生成手机号 code。
- 官方多账号调试使用虚拟测试账号。任务允许虚拟数据时，结果必须标记为虚拟账号/虚拟手机号，不得冒充真实用户手机号；仍禁止直接合成回调或迁移凭证。

## CDP 与官方工具

- 使用 [probe-cdp-inspectee.mjs](../scripts/probe-cdp-inspectee.mjs) 可只读确认当前 9420 的 CDP 风格协议。
- 协议只有小程序 inspectee 的 `DOM`、`Runtime`、`Network` 等域而没有 `Target`/`Browser` 时，不能控制 Electron BrowserWindow、WebView target 或系统原生手机号授权面。
- 显式用空闲的本机 `--remote-debugging-port` 启动 Electron 后，可以枚举同一实例的项目 BrowserWindow、模拟器和 WebView target；这只扩展可观察面，不会增加手机号凭证或测试账号选择 API。现代原生应用菜单也不一定出现在页面 DOM 中。
- 官方 toolCall 和公开 `miniprogram-automator@0.12.1` 没有生成手机号凭证的专用 API。
- 不调用内部 Redux/action、业务 handler、`WxComponent.triggerEvent` 或 `triggerNativeEvent` 绕过可见账号选择与授权。

## 允许虚拟数据时

1. 先确认目标 9420 窗口实际运行在测试用户上下文；内置账号名称、旧 CLI 参数或空 `testAccounts()` 都不能单独证明已激活。
2. 若公开 CLI/toolCall 没有账号选择动作，最小前置是人工在开发者工具可见的测试账号/多账号调试界面选择虚拟账号，并让同一目标窗口重新建立 9420。
3. 再执行可见协议勾选、`open-type="getPhoneNumber"` 点击和已出现授权面的 `authorizeAllow()`。
4. 仍按业务请求、storage 和已登录页面验证；成功时明确记录为虚拟账号/虚拟手机号结果。
5. 若已确认虚拟账号生效但仍无授权面，停止并核对开发者工具的官方手机号模拟返回配置或业务后台虚拟手机号支持，不直接 mock `getPhoneNumber` 回调。

## 环境升级路径

- 真机调试、云测或真实账号属于独立环境路径，不因一次按钮点击自动获得授权。
- 只有用户明确授权切换环境、重启 IDE、生成二维码或修改项目配置时才能执行相应动作。
- 真机路径仍要求真实用户在微信客户端完成可见手机号授权；云测登录态不得迁移回本地 9420。

## 停止条件

当前窗口未激活测试用户、真实点击后没有授权面，且公开工具没有账号选择动作时，报告能力受限并给出人工选择测试用户的最小前置。不得把旧启动参数、按钮点击、空 `{}`、CDP 命令成功或二维码生成报告为业务登录成功。

参考：[Automator MiniProgram API](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/miniprogram.html)、[真机自动化](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/remote.html)。
