# Issue #40 修复与待复现项

来源：https://github.com/flizzywine/dsh-tavern/issues/40
核对日期：2026-09-17

## 已修改

- 人物卡不支持的命令管道在修改草稿和提交前失败，错误指出具体命令。`/send … | /cut 0 | /trigger` 不再把 `/cut` 当正文发送。`/cut` 删除楼层仍未实现；支持范围见 [命令兼容说明](../slash-command-compatibility.md)。
- 脚本回调失败时保留最内层脚本身份；异步回调、冻结错误对象和外层宿主事件不会覆盖原始归属。这不证明附件中的变量错误一定来自小手机脚本，也不消除变量适配错误本身。
- MVU SOURCE.md 更新实际产物哈希并移除不存在的测试声明。运行时 MVU 产物本身通过校验。

## 模板执行器失联：已复现并修复 RPC 连接泄漏路径

独立心跳原本已存在。问题在传输边界：iframe 的 15 秒 RPC 超时只拒绝本地 Promise，没有取消父页面的 fetch；重试会留下仍占连接的请求。浏览器同源 HTTP 连接被这些请求占满后，即使服务已恢复，新心跳也无法送达，在线租约过期，后续任务报 `FULL_TEMPLATE_UNAVAILABLE`。

`tests/template-rpc-recovery-browser.test.mjs` 使用正式 iframe 执行器、真实 Chromium HTTP 连接和服务端调度器，仅替换模板计算体，并加速客户端计时器。先成功执行一项任务，再让心跳/领取请求不返回；累计六次故障后恢复服务并推进服务端时钟使租约过期。修复前第二项任务报同一个错误，修复后心跳恢复、任务完成，挂起连接峰值低于六；销毁执行器后未完成连接归零。

修复：iframe 超时通知父页面取消；父页面为 RPC 配置 AbortController 和独立期限，向正式 rpc/fetch 传递 signal；销毁执行器时取消待办。没有延长 TTL，也没有重跑已开始的模板计算。

另用正式打包模板与 iframe 做了实际 70 秒闲置探测，前后渲染均成功。其模拟人物卡的世界书同步发生了字段缺失错误，因此该探测只支持在线/渲染结论，不作为完整人物卡验收。

## pnpm 打印 Done 后挂起：已复现并修复版本检查路径

pnpm 11.8.0 安装时会启动不等待结果的自身版本检查；依赖安装虽已结束，检查使用的网络请求仍可维持 Node 事件循环。旧 Windows/Unix 安装器及通用子进程环境未禁用此检查，Android 安装器已有对应设置。

`tests/pnpm-install-exit.test.mjs` 的实进程用例启动一个永不响应的本地 registry，对空项目执行已安装的 pnpm，隔离版本检查缓存，不下载项目依赖。修复前输出 `Done in 242ms using pnpm v11.8.0` 后超时，服务端收到 `/pnpm`；修复后退出码 0，服务端没有版本检查请求。通过 `TAVERN_PNPM_ENTRY` 指定已有的 pnpm 入口运行该用例。

修复：安装器和 `runtimeEnvironment()` 为子进程设置 `pnpm_config_update_notifier=false`，覆盖 Profile/插件依赖安装；PowerShell finally 恢复调用者的原值。未关闭依赖下载、未强制把失败判成成功，也未修改 Desktop 文件。

通过 `TAVERN_PNPM_RUNTIME`、`TAVERN_PNPM_PRELOAD` 另外验证了本机 Desktop 2.0.5 的 Electron 43.3.0 / Node 24.18.1 加 clear-env.mjs 启动链路，退出正常。删除 ELECTRON_RUN_AS_NODE 本身没有在这组对照中导致挂起。

## 证据边界

上述是与报告症状一致、能够稳定红绿验证的两条真实故障路径。原附件没有心跳网络轨迹或 pnpm 活动句柄，不能追认它们就是原现场唯一原因；本机也没有完成 Windows 原机复测。若报告者更新后仍有问题，应保留故障时的浏览器网络状态、实际加载版本及 pnpm 进程/活动句柄，继续定位其他触发条件。

## DSH dispose 异常：宿主依赖

Desktop 自带的 `@deepseek-ai/dsh-file-reference-local/lib/index.js` 在 disposePrompt 中直接调用 `fiber.dispose().catch(...)`。如果 dispose 返回 undefined，会产生报告中的 TypeError。修复应在宿主依赖中同时处理同步返回、同步抛出及 Promise 拒绝，例如将调用置于 `Promise.resolve().then(() => fiber.dispose()).catch(...)`。

该依赖不由 Tavern 的 pnpm 工作区安装；本次没有修改用户已安装的 Desktop，也没有声称 Tavern 更新可以修复它。
