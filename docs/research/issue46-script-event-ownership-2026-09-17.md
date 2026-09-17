# Issue #46：MVU 事件归属竞态与错误码丢失

## 已复现的根因

基线 `0dbf14d`，用生产 Host Adapter、Script Dispatch 和 Helper 回调建立确定性测试，未使用报告者的私人卡片。

1. 普通 `MESSAGE_RECEIVED` 尚在执行时，`settleMvuUpdate` 在准备上下文之前就安装了结算事务。
   上下文准备会等待卡片/世界书读取，期间旧事件的合法写入被 `assertTransactionEvent` 拒绝；
   等到后面的 dispatch 返回 busy 时才发现执行器被占用，已经造成误拒。
2. 防重入检查在 `await resolveChat` 之前，两个同时启动的尝试都能通过检查，随后覆盖同一 session 的事务。
   一个尝试的失败清理还可能移除另一个尝试的事务。
3. 结算已预约事务、仍在等待上下文时，普通生命周期 dispatch 可以先占用执行器，形成反方向竞争。
4. 错误码在 HTTP JSON envelope、前端 RPC Error、父页面给脚本的响应和事件完成回执中没有完整保留。
   文字拒因原本会返回，并非宿主完全不回错误。
5. 脚本捕获失败后继续等待时，超时消息覆盖了此前收到的拒因。

## 修复

- 执行器已有事件时，MVU 在安装事务前返回 deferred；原事件可以完成合法写入。
- 读取 Chat 后、安装事务前再次检查所有权；检查和安装之间没有 await。
- 普通生命周期 dispatch 尊重已经预约的 MVU 事务，返回已有的 busy 协议结果，不挤入上下文准备窗口。
- 从 HTTP 到脚本 Error.code，再到失败完成回执保留错误码；兼容旧版没有错误码的响应。
- 迟到写入返回 `TAVERN_SCRIPT_EVENT_CLOSED`。超时返回 `TAVERN_SCRIPT_EVENT_TIMEOUT`，并保留此前宿主错误作为 cause 和说明。
- 事件诊断保留 errorCode、causeCode、待完成调用数和经过时间，不新增变量正文采集。

保留原有事件顺序、15 秒无进展/60 秒总预算和迟到写入保护；没有改成并行事件、自动重放副作用或扩大超时。
也没有改动 LLM 提示词、消息顺序或上下文缓存参数。

## 脚本写入契约

`MESSAGE_RECEIVED` 回调内支持变量写入。宿主 MVU 结算事件中，写入进入本事件的隔离草稿；验证后再提交 effect。
普通事件不要求脚本自己创建 MVU 事务。事件标识由 Helper 自动携带，卡片不应伪造。

```js
eventOn(tavern_events.MESSAGE_RECEIVED, async messageId => {
  const option = { type: 'message', message_id: messageId };
  const variables = getVariables(option);
  // 在此执行同步计算，修改 variables。
  await replaceVariables(variables, option);
});
```

异步处理和写入要由回调返回的 Promise 覆盖。不要用脱离回调的定时任务重放旧事件的写入；
遇到 `MVU_SETTLEMENT_EVENT_MISMATCH` / `TAVERN_SCRIPT_EVENT_CLOSED`，结束当前处理并向上传递错误，
不要继续等待一个不会到来的成功回执，也不要循环重试相同旧数据。

## 验证

- 三个所有权竞态测试在修复前失败、修复后通过，包含真实 dispatch 的领取/开始/完成流程。
- 生产 Helper 在 await 后仍携带正确事件标识；合法写入进入隔离草稿，迟到重放迅速返回错误码且不写权威 Chat。
- HTTP POST 生产处理器、浏览器 RPC、脚本通信和事件结束/超时分别覆盖结构化错误码回归；旧服务端纯文字错误仍可读取。
- 无需真实 LLM、浏览器账号或付费请求。

可复现命令：

```sh
node --test tests/tavern-script-host-adapter.test.mjs tests/mvu-event-ownership.test.mjs tests/tavern-rpc-errors.test.mjs tests/request-performance-client.test.mjs tests/helper-compatibility-modules.test.mjs tests/card-runtime-lifecycle.test.mjs
node bin/build-tavern-client.mjs --check
node bin/test-tavern.mjs
```

## 范围限制

上述竞态可以产生同样的 `MVU_SETTLEMENT_EVENT_MISMATCH`，但没有报告者的辅助脚本与同一次事件的日志，
不能认定已逐项重放其全部 15 秒超时。脚本自身持续计算、吞掉异常或永不结束的等待仍会受原有预算限制。

issue 中跨数天 API 最大耗时不是本次竞态的单轮时序证据，不能相加当成每轮预算。
本次没有对该私人存档重新跑性能测试。

模板 `PROMPT_TEMPLATE_STATE_CONFLICT` 是保护过期写入的错误，不等于模板数据损坏。
两条 JSON 解析错误缺少出错文件和调用栈，尚未确认属于响应截断还是权威存档损坏；
本次不自动清空变量、删除存档或以默认状态覆盖它们。

最终验证：定向 80 项通过；独立工作区补齐与主工作区相同的依赖链接后，全量 2582 项通过、6 项跳过、0 失败。
客户端已重建并通过 `--check`。首次全量尝试因独立工作区缺少 `tavern-plugin/node_modules` 链接而出现模块加载失败，补齐依赖后消失。
