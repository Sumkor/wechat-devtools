# Network 取证

任务需要确认请求、接口响应或提取响应字段时完整读取本文。

## 能力边界

- 使用官方 `get_simulator_network` 读取模拟器 network 缓冲，不连接远程调试端口，也不直接调用 CDP。
- 记录可能包含 `HTTP_REQUEST`、`HTTP_RESPONSE`、状态码、headers 和 `detail.response`。
- `detail.response` 可能因二进制、流式、过大、刷新清空或未缓冲而缺失或截断；不能承诺完整响应体。
- `SdkReport` 只代表微信运行时上报，不能证明项目业务初始化或目标接口成功。

## 查询与过滤

1. `--command` 使用简单的 `grep -in keyword` 或 `grep -n .`。Windows `.cmd` 桥接时避免未转义的 `|`、`&`；多关键字分开查询。
2. grep 输出是候选集合，可能夹带分隔符或相邻无关记录。只接受同时匹配预期 `type` 和 `detail.url` 的记录。
3. 需要确定性过滤时，将官方命令的结构化 stdout 直接传给跨平台 Node.js 脚本：

```text
<wechatide> -c Agent get_simulator_network \
  --project <absolute-project-path> \
  --command "grep -in product/search" \
| node <skill-root>/scripts/select-network-records.mjs \
    --url-contains /product/search \
    --type HTTP_RESPONSE
```

Windows 与 macOS 都直接调用 `.mjs`，不维护 PowerShell、Bash、批处理或 Python 包装逻辑。Node 不可用时停止。

## 证据判定

- 验证 URL、类型、状态码和内容与目标动作一致；整段文本含关键字不等于其中每条记录都匹配。
- `matched: 0` 表示没有通过 URL/type 校验的记录，不等于接口返回空数据。
- 第一次没有命中时先确认目标动作是否发生、运行时是否仍在。用户任务允许时只触发目标动作一次，再查询一次；不循环刷新或重放。
- CLI 的结构化 stdout 与授权/连接 stderr 分开判断；`ok: true` 只表示该次 toolCall 成功，不证明页面或业务接口就绪。

## 数据最小化

- 最终只返回任务需要的响应字段。
- 不复述 token、cookie、完整 headers、手机号、精确位置或其它无关个人数据。
- 无法验证响应属于目标 URL 时丢弃，不用相邻记录补充或猜测。

## 成功与停止

业务取证成功必须命中目标 URL，并验证对应响应内容。只有空缓冲、`SdkReport`、无关定位请求、截断且无法校验的响应或过滤结果为零时，报告未确认并停止推断。
