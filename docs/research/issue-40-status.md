# Issue #40 修复与待复现项

来源：https://github.com/flizzywine/dsh-tavern/issues/40
核对日期：2026-09-17

## 已修改

- 人物卡不支持的命令管道在修改草稿和提交前失败，错误指出具体命令。`/send … | /cut 0 | /trigger` 不再把 `/cut` 当正文发送。`/cut` 删除楼层仍未实现；支持范围见 [命令兼容说明](../slash-command-compatibility.md)。
- 脚本回调失败时保留最内层脚本身份；异步回调、冻结错误对象和外层宿主事件不会覆盖原始归属。这不证明附件中的变量错误一定来自小手机脚本，也不消除变量适配错误本身。
- MVU SOURCE.md 更新实际产物哈希并移除不存在的测试声明。运行时 MVU 产物本身通过校验。

## 模板执行器失联：尚未复现报告环境

独立心跳已存在于更新目标 d4424c 的祖先 ececb26；更新目标不等于故障发生时加载的前端版本。

现有心跳与真实服务端调度器组合的虚拟时间测试验证了闲置十分钟仍保持就绪，以及暂停 97 秒后下一次心跳恢复在线；这是协议测试，不是 Windows 浏览器后台节流实测。没有修改 TTL，也没有重跑已开始的模板任务。

下一次现场需要：故障时实际运行版本、刷新前后差异、酒馆导出的诊断包中 `environment.templateRuntime` 的心跳/任务状态、浏览器心跳请求的成功/失败与时间。不要只凭 FULL_TEMPLATE_UNAVAILABLE 推断没有心跳。

## Windows pnpm 挂起：尚未复现

附件证明安装输出完成后进程仍未退出，但没有保留活动句柄、子进程树或堆栈。当前验证环境是 macOS。Electron 启动后清除 ELECTRON_RUN_AS_NODE 不会把当前 Node 进程变回 GUI，不能仅凭该语句判断根因或删除它。

下一次应在终止挂起进程之前保留 Windows 进程树、完整启动参数（去除凭据）、pnpm 版本和活动句柄；比较系统 Node 与 Desktop shim 的隔离安装。未改安装器，也未将其标为修复。

## DSH dispose 异常：宿主依赖

Desktop 自带的 `@deepseek-ai/dsh-file-reference-local/lib/index.js` 在 disposePrompt 中直接调用 `fiber.dispose().catch(...)`。如果 dispose 返回 undefined，会产生报告中的 TypeError。修复应在宿主依赖中同时处理同步返回、同步抛出及 Promise 拒绝，例如将调用置于 `Promise.resolve().then(() => fiber.dispose()).catch(...)`。

该依赖不由 Tavern 的 pnpm 工作区安装；本次没有修改用户已安装的 Desktop，也没有声称 Tavern 更新可以修复它。
