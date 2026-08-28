# 微信开发者工具安装根发现

在安装根、官方 Skill 根或 CLI 绝对路径未知时读取本文。目标是只读地得到候选路径，再用安装包证据确认；不能把注册表、快捷方式或常见目录中的单条命中直接当成有效安装。

## 总体顺序

1. 用户已提供安装根，或官方 installer/诊断已经返回绝对 `command`：优先使用并进入“候选验证”。
2. 当前 shell 能解析 `wechatide`：读取命令的绝对路径，以其所在安装包为候选；不要只因为 PATH 中有同名命令就跳过验证。
3. Windows 安装根仍未知：依次查询卸载注册表、解析微信开发者工具快捷方式、有限枚举腾讯相关安装目录。
4. macOS 安装根仍未知：优先运行已可定位的官方 installer；否则只检查标准 Applications 位置和用户提供的 `.app`，不要套用 Windows 文件名。
5. 对所有候选执行 metadata、运行时形态和 CLI 入口验证。只有一个候选证据完整时才继续；多候选冲突或证据不足时停止启动变更并报告候选。

如果已经能定位官方 `wechatide-skill`，优先运行其中 `skills/installer/scripts/check-installation.mjs`，使用返回的绝对 `command`、`version` 和 `reason`。本文主要解决“连官方 installer 所在安装根也未知”的引导问题。

## Windows 发现链路

### 1. PATH 命令

```powershell
Get-Command wechatide -ErrorAction SilentlyContinue |
  Select-Object Name, Source, Path
```

`Source`/`Path` 只产生候选。继续确认该路径属于真实微信开发者工具安装包，而不是残留脚本或代理命令。

### 2. 卸载注册表

Windows 安装器通常会在以下位置写入卸载信息：

```powershell
$wechatUninstallKeys = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

Get-ItemProperty $wechatUninstallKeys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match '微信.*开发|WeChat.*Dev' } |
  Select-Object DisplayName, DisplayVersion, InstallLocation, DisplayIcon
```

候选根目录按以下顺序提取：

- `InstallLocation` 非空：作为候选根。
- `DisplayIcon` 指向绝对可执行文件：去掉外围引号和可能的 `,0` 图标索引，以其父目录作为候选根。
- 注册表值只用于读取路径，禁止把其中内容拼成待执行命令。

卸载项/快捷方式得到的路径只作为本机发现证据，不应写成跨机器默认路径；版本号仍需回读安装包 metadata 交叉验证。

### 3. 快捷方式

注册表缺失或字段为空时，只读检查当前用户/公共开始菜单和桌面的相关 `.lnk`，解析其 `TargetPath`：

```powershell
$wechatShortcutDirs = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:USERPROFILE\Desktop",
  "$env:PUBLIC\Desktop"
)

$wechatShell = New-Object -ComObject WScript.Shell
foreach ($wechatShortcutDir in $wechatShortcutDirs) {
  if (-not (Test-Path -LiteralPath $wechatShortcutDir)) { continue }
  Get-ChildItem -LiteralPath $wechatShortcutDir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '微信.*开发|WeChat.*Dev' } |
    ForEach-Object {
      $wechatShortcut = $wechatShell.CreateShortcut($_.FullName)
      [PSCustomObject]@{
        Shortcut = $_.FullName
        TargetPath = $wechatShortcut.TargetPath
        Arguments = $wechatShortcut.Arguments
      }
    }
}
```

只接受绝对 `TargetPath`，并以目标文件父目录生成候选；不要执行快捷方式参数。

### 4. 有限目录检查

PATH、注册表和快捷方式均无结果时，只检查 `Program Files`、`Program Files (x86)`、`LOCALAPPDATA` 下名称匹配 `Tencent`、`WechatTool`、`微信开发者工具` 的浅层目录。禁止递归扫描整个磁盘，也不要因为目录名相似就直接启动其中 EXE。

## macOS 发现链路

### 1. PATH 中的官方命令

先检查当前 shell 是否已经能解析官方命令：

```sh
command -v wechatide
type -P wechatide
```

命令路径只作为候选。若它是符号链接，解析后得到其真实目标，再向上定位 `.app` 根目录；不要把命令名本身当成安装根。

### 2. 官方 installer/诊断

如果已经找到任意官方 Skill 根，优先运行其中的 `skills/installer/scripts/check-installation.mjs`。它会检查标准应用位置和 app bundle 内的 metadata，并返回 `version`、`reason` 以及可用的绝对 `command`。用户提供自定义 `.app` 时，显式传入：

```sh
node <official-skill-root>/skills/installer/scripts/check-installation.mjs \
  --install-root "<app-root>"
```

### 3. 有限候选搜索

installer 无法定位时，只在有限范围内查找应用包，不扫描整个磁盘：

```sh
find /Applications "$HOME/Applications" -maxdepth 2 \
  \( -iname '*wechat*dev*.app' -o -iname '*微信*开发*.app' \) \
  -print 2>/dev/null
```

也可以使用 Spotlight 生成候选（结果仍需验证）：

```sh
mdfind 'kMDItemContentType == "com.apple.application-bundle" && (kMDItemFSName == "*wechat*"cd || kMDItemFSName == "*微信*"cd)'
```

不要假设应用一定位于 `/Applications`，也不要仅凭 bundle 名称启动候选。DMG 拖装和 PKG 安装的 PATH/软链行为可能不同。

### 4. app bundle 验证

对每个候选 `<app-root>` 检查：

1. Electron metadata：`<app-root>/Contents/Resources/app.asar.unpacked/package.json`。
2. NW.js metadata：`<app-root>/Contents/Resources/package.nw/package.json`。
3. 官方 toolCall 入口：`<app-root>/Contents/MacOS/wechatide` 是否存在并可执行。
4. npm Automator 入口：当前安装包是否提供可用的 `auto --project ... --auto-port <port>` 入口，不从 Windows 的 `cli.bat` 名称推断 macOS 对应命令。
5. 最终以 9420 WebSocket 握手和非空 `currentPage().path` 验证 npm 运行时，而不是以 `.app` 存在或 GUI 启动成功代替。

### 5. PATH/软链补齐

若官方诊断返回 app 内绝对 `command`，但 `command -v wechatide` 为空，优先使用官方 installer 提供的 `ensure-cli-path.mjs` 创建软链；不要因为 PATH 缺失重新下载或复制应用包。

## 候选验证

对每个候选根逐项确认：

1. 桌面宿主可执行文件或 app bundle 实际存在。
2. Electron metadata：Windows 检查 `resources/app.asar.unpacked/package.json`；macOS 检查 `Contents/Resources/app.asar.unpacked/package.json`，并读取 `name`、`productName`、`version`、`main`。
3. NW.js metadata：Windows 检查 `code/package.nw/package.json`；macOS 检查 `Contents/Resources/package.nw/package.json`。Electron 与 NW.js 的路由按 [运行时选择](runtime-selection.md) 判定。
4. 官方入口和 npm Automator 入口都必须检查当前安装包实际存在的文件，不用某个平台的文件名推断另一平台的命令。
5. 对候选 CLI 先执行 `--help`/子命令 `--help`。某些版本会隐藏 `--auto-port`，此时可只读检查安装包 CLI 注册信息，或在满足单窗口规则后执行一次受控启动验证，不能凭旧版本经验猜参数。
6. 最终用 9420 WebSocket 握手和非空 `currentPage().path` 证明 Automator 入口可用；metadata 或 CLI 文件存在本身不能替代运行时证据。

若 Electron metadata 与 NW.js metadata 同时存在、多个候选都像有效安装、注册表版本与 metadata 版本矛盾，或入口文件属于不同根目录，标记为 `ambiguous` 并停止开窗/启动。

## 报告字段

至少记录：

- `discoverySource`：`user`、`installer`、`path`、`uninstall-registry`、`shortcut` 或 `limited-directory-check`
- `installRoot`：验证后的绝对路径
- `desktopExecutable`、`officialCli`、`automatorCli`：实际存在的绝对路径；不存在则省略
- `version`：来自安装包 metadata 或官方 installer
- `runtimeShape`：`electron`、`nwjs` 或 `ambiguous`
- `validationEvidence`：metadata、CLI help、9420 握手等已确认项

不要把一次机器上的安装目录写成全局默认值，也不要在报告中输出 token 或其它登录凭证。
