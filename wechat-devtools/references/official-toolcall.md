# 官方 skill + toolCall 参考

本文保留现代微信开发者工具官方路径的定位和调用顺序。它是辅助路径，不替代 npm Automator 主路径。

## 解析安装与 Skill

不要写死 Windows 或 macOS 安装目录。优先使用用户提供的安装根，或运行当前安装包随附的 installer/diagnostic 脚本解析：

- 官方 Skill 根：`<install-root>/resources/app.asar.unpacked/wechatide-skill`
- 官方 CLI 入口：`<install-root>/wechatide.cmd`（仅当当前平台和安装包实际存在）
- macOS 应用包通常使用 `<app-root>/Contents/MacOS/wechatide`，但必须以当前安装包实际文件为准。

官方 installer 的 `check-installation.mjs` 会返回 `version`，并通过安装包内 Electron/NW.js metadata 判定运行时；`version` 与 CLI 可用性是独立字段，不能因为 CLI 检查失败就丢弃版本证据。版本号可用于与官方发布说明对照，但自动化路由仍应结合 metadata、诊断 reason 和实际 9420 握手。

注意：官方 toolCall 的 `check_wechatide_status` 主要返回登录态、Skill `versionRelation` 和 token 门禁，不是开发者工具桌面版本号。要读取 IDE 版本，应使用 installer 的安装检查或直接读取安装包 metadata。

首次调用前完整读取官方根 `SKILL.md`、目标 scene 的 `SKILL.md` 和 `references/environment-readiness.md`；网络任务另读本 Skill 的 [network-evidence.md](network-evidence.md)。不要复制或修改安装目录中的官方 Skill。

## 调用顺序

固定客户端名为 `Agent`，命令和参数从当前版本注册表或 `--help` 获取：

```text
<official-cli> -c Agent check_wechatide_status --skill-version <skill-version>
<official-cli> -c Agent <registered-tool> <flags>
```

按需选择 `initializer`、`project-manager`、`compiler`、`automator`、`debugger` 等 scene，并按官方异步任务规则轮询。状态、授权、项目元数据和 debugger 证据不能由窗口标题或进程存在替代。

## 能力边界

官方 toolCall 适合环境检查、项目管理、编译/刷新、普通元素操作、截图、console 和官方 simulator network。当前版本对部分自定义组件内部节点支持不稳定，可能出现 `no such element`；不要假设它能操作任意组件内部元素。官方 network 缓冲只属于官方 toolCall 运行时，不能读取独立 npm 9420 会话。
