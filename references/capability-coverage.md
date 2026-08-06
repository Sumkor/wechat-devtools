# Capability Coverage

## 定位

本 Skill 不是把 `miniprogram-automator` 官方 API 一比一展开成 40 多个固定命令，而是采用：

- 高频能力直接封装为稳定 CLI
- 长尾能力通过受控 `invoke` 暴露

这样可以避免重新制造大量长期占用上下文的工具定义，同时保留官方 API 的灵活度。

## 已显式封装

### 会话

- `session start`
- `session status`
- `session stop`

### 页面

- `page current`
- `page stack`
- `page data`
- `page set-data`
- `page call-method`
- `page navigate`
- `page screenshot`
- `page wait`

### 元素

- `element query`
- `element query-all`
- `element tap`
- `element tap-text`
- `element input`
- `element data`
- `element call-method`

### 手势与滚动

- `gesture swipe`
- `scroll-view to`

### wx 与断言

- `wx call`
- `wx mock`
- `wx restore`
- `assert visible`
- `assert text`
- `assert data`
- `assert path`

### 能力查询与扩展

- `capability list`
- `invoke`

## 当前通过 `invoke` 保留的官方能力

以下能力没有全部做成独立顶级命令，但可通过 `invoke` 调用：

### MiniProgram 常见长尾能力

- `pageScrollTo`
- 其他未单独封装的 `miniProgram.*` 方法

示例：

```shell
node .\scripts\weapp-auto.js invoke --target miniProgram --method pageScrollTo --args-json '[500]'
```

为避免任意脚本执行或破坏 daemon 持有的会话，`evaluate` 和 `disconnect` 不允许通过 `invoke` 调用。

### Page 常见长尾能力

- `scrollTop`
- `size`
- `waitFor`
- 其他未单独封装但属于 `page.*` 的方法

示例：

```shell
node .\scripts\weapp-auto.js invoke --target page --method scrollTop
node .\scripts\weapp-auto.js invoke --target page --method size
```

### Element 常见长尾能力

- `scrollHeight`
- `scrollWidth`
- `longpress`
- `trigger`
- `touchstart`
- `touchmove`
- `touchend`
- 其他未单独封装但属于 `element.*` 的方法

示例：

```shell
node .\scripts\weapp-auto.js invoke --target element --selector 'scroll-view' --method scrollHeight
node .\scripts\weapp-auto.js invoke --target element --selector '.menu' --method longpress
```

## 为什么不全量展开

- 顶级命令数量越多，Skill 文档和使用面越重。
- 当前目标是把高频操作稳定化，而不是镜像全部官方 API。
- `invoke` 可以作为升级缓冲层：先可用，确认高频后再提升为一级命令。

## 何时该新增一级命令

满足以下任一条件时，考虑把某个 `invoke` 能力提升为显式命令：

- 多次被真实任务重复调用
- 参数语义复杂，裸 `args-json` 可读性差
- 需要额外等待、断言或错误归因
- 需要安全边界，不能直接开放原始调用

## 当前结论

- 高频能力：已覆盖
- 官方全部能力：未做一比一顶级封装
- 动态灵活度：已保留，通过 `capability list` + `invoke` 使用
