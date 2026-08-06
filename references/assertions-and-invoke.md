# Assertions And Invoke

## 常用断言

### 可见性

```shell
node .\scripts\weapp-auto.js assert visible --selector '.result' --timeout 8000
```

### 文本

```shell
node .\scripts\weapp-auto.js assert text --selector '.toast' --expected '成功'
node .\scripts\weapp-auto.js assert text --selector '.title' --expected '订单详情' --mode equals
```

### data

```shell
node .\scripts\weapp-auto.js assert data --path 'form.status' --expected-json '"done"'
```

### path

```shell
node .\scripts\weapp-auto.js assert path --expected 'pages/result/index'
```

## wx 能力

```shell
node .\scripts\weapp-auto.js wx call --method getStorageSync --args-json '["token"]'
node .\scripts\weapp-auto.js wx mock --method chooseLocation --result-json '{"name":"mock"}'
node .\scripts\weapp-auto.js wx restore --method chooseLocation
```

## 受控 invoke

`invoke` 是 escape hatch，只接受简单方法名和 JSON 数组参数，不允许原型链、`evaluate`、`disconnect` 或任意脚本注入。

```shell
node .\scripts\weapp-auto.js capability list --target miniProgram
node .\scripts\weapp-auto.js invoke --target page --method scrollTop
node .\scripts\weapp-auto.js invoke --target element --selector 'scroll-view' --method scrollHeight
```

优先使用已封装的高频命令。只有官方能力存在、但 CLI 尚未独立封装时，才使用 `invoke`。
