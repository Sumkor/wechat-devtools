# Gestures And Selectors

## swipe 与 scroll-view 的区别

- `gesture swipe` 通过官方 `element.touchstart/touchmove/touchend` 组成可靠触摸序列，适合列表、轮播、拖动类手势。
- `scroll-view to` 直接调用官方 `ScrollViewElement.scrollTo(x, y)`，只适用于 `scroll-view` 组件。
- 不要用 `swipe` 冒充 `scroll-view scrollTo`，也不要用 `scrollTo` 冒充通用滑动手势。

## swipe 命令

```shell
node .\scripts\weapp-auto.js gesture swipe --selector '.list' --direction up
node .\scripts\weapp-auto.js gesture swipe --selector '.carousel' --direction left --steps 10
```

参数说明：

- `--selector`：手势作用元素，必填。
- `--direction`：`up|down|left|right`。
- `--steps`：触摸移动分段数，默认 `6`。
- `--margin-ratio`：起止点相对元素边界的保留比例，默认 `0.2`。

## scroll-view 命令

```shell
node .\scripts\weapp-auto.js scroll-view to --selector 'scroll-view' --x 0 --y 1200
```

建议先确认目标元素确实是 `scroll-view`，再调用 `scrollTo`。

## selector 选择建议

- 优先使用稳定 class、id、组件标签，不依赖运行时索引文本。
- `page.$` / `page.$$` 不保证穿透自定义组件。`invoke --target element` 只能操作已选中的元素，不能借外层元素访问其内部节点；此时改读组件 data、精确组件 selector 或业务源码。
- `tap-text` 默认只扫描 `text`、`button`、`view`；要缩小范围时显式传 `--selector`。
