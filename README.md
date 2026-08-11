# wechat-devtools

用于让 AI Agent 操作微信小程序的微信开发者工具 Skills，支持打开项目、登录、编译、页面交互、截图、断言和请求排查。

仓库分别适配现代 Electron 版和旧版 NW.js 微信开发者工具。两套流程彼此隔离，请根据本机版本选择并安装其中一个 Skill。

## 选择 Skill

| 微信开发者工具 | 安装目录 | 调用名称 | 自动化方式 |
| --- | --- | --- | --- |
| 现代 Electron 版（默认推荐） | [`wechat-devtools`](wechat-devtools/) | `$wechat-devtools` | 官方 MCP/Skill 与 toolCall |
| 旧版 NW.js | [`wechat-devtools-nwjs`](wechat-devtools-nwjs/) | `$wechat-devtools-nwjs` | 9420 与 miniprogram-automator |

如果你使用的是当前版本的微信开发者工具，选择 `$wechat-devtools`。只有明确使用旧版 NW.js，或现代版 Skill 检测后提示切换时，才选择 `$wechat-devtools-nwjs`。

不要对同一个 IDE 混用两个 Skill。

## 安装

先克隆仓库：

```shell
git clone https://github.com/Sumkor/wechat-devtools.git
```

再将需要的一个 Skill 目录复制到个人 Skill 目录 `~/.agents/skills/`。

### 现代 Electron 版

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
Copy-Item -Recurse .\wechat-devtools\wechat-devtools "$HOME\.agents\skills\wechat-devtools"
```

macOS：

```bash
mkdir -p ~/.agents/skills
cp -R ./wechat-devtools/wechat-devtools ~/.agents/skills/wechat-devtools
```

现代版依赖微信开发者工具内置的官方 Skill 和 MCP/toolCall。首次使用时，按 IDE 提示完成 MCP 客户端授权。

### 旧版 NW.js

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
Copy-Item -Recurse .\wechat-devtools\wechat-devtools-nwjs "$HOME\.agents\skills\wechat-devtools-nwjs"
Set-Location "$HOME\.agents\skills\wechat-devtools-nwjs"
npm install
```

macOS：

```bash
mkdir -p ~/.agents/skills
cp -R ./wechat-devtools/wechat-devtools-nwjs ~/.agents/skills/wechat-devtools-nwjs
cd ~/.agents/skills/wechat-devtools-nwjs
npm install
```

旧版需要 Node.js、微信开发者工具 CLI，以及支持 9420 自动化端口的 NW.js 微信开发者工具。

## 使用示例

现代版：

```text
$wechat-devtools 打开 C:\Code\my-miniapp 项目
$wechat-devtools 打开项目，完成登录并进入首页
$wechat-devtools 进入商品详情页，返回商品信息和关键接口结果
```

旧版 NW.js：

```text
$wechat-devtools-nwjs 打开 C:\Code\my-miniapp 项目
$wechat-devtools-nwjs 搜索商品，进入第一个商品详情页并截图
```

只需描述业务目标，不需要手工拆解成启动、编译、点击和抓包命令。Skill 会按实际状态执行，并准确报告项目是否已经打开、构建和进入可操作状态。

## 主要能力

- 启动或附着微信开发者工具，避免重复打开 IDE
- 打开项目并确认编译、模拟器和自动化运行状态
- 点击、输入、滚动、页面跳转和业务登录
- 获取页面信息、截图、控制台和关键网络请求
- 在启动失败、授权缺失或运行时不匹配时给出明确提示

## 详细说明

- [现代 Electron 版 Skill](wechat-devtools/SKILL.md)
- [旧版 NW.js Skill](wechat-devtools-nwjs/SKILL.md)
- [现代版启动与附着 SOP](wechat-devtools/references/startup-and-attach-sop.md)
- [旧版启动与故障诊断](wechat-devtools-nwjs/references/diagnostics.md)

## License

[MIT License](LICENSE)
