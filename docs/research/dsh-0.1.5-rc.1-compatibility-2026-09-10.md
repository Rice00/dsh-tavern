# DSH 0.1.5-rc.1 适配研究

日期：2026-09-10。分支：`feat/isolated-cli-dsh-runtime`。

## 结论

基础适配已实现，但尚不能宣称支持 0.1.5-rc.1。保持 CLI 默认 0.1.2-rc.1，Desktop/DSHA 推荐版本暂不调整。两个 native Session 障碍影响正文编辑、回退及已有存档；不要以重写历史、伪装消息角色或修改 node_modules 绕过。

## 已实现

- 将新写入事件集中到 Session 边界：V3 replacement 的 start/end 转换为 startSeq/endSeq，V2 保持原样。
- 导入恢复比较使用同一新事件数据规范，避免 V3 新增 stream 导致重复导入误报。
- V3 合成 assistant append 不再携带 sourceEventSeqs，并提供空内嵌 stream；保留消息本身。已有事件不改写。
- 回退和后台投影读取两种 replacement 坐标。
- Persona 同时提供旧 text 与新 prefix/suffix 空配置。
- Token Meter 兼容新版 _foldEvent(state, event)，由同步入口传递当前 Session；仅计量时使用合成消息投影，不修改事件和请求。旧版 5 项原生计量测试通过，新版无 step 种子计量测试通过。

## 实测

独立临时 npm runtime、Profile、数据目录和 3185 端口；没有升级日常使用的私有 runtime，没有读取真实存档，也没有发送付费模型请求。

- 新 runtime 安装、依赖/interface 探测、dump-config、启动均成功。
- 实际浏览器可打开 Tavern，新建空白卡片工作台，看到开场与人物卡/预设/世界书/剧本资源侧栏。没有据此宣称完整游玩通过。
- 新版原始全量测试：1871 项，1823 通过，48 失败。失败包含真实协议变化及旧版测试 fixture 假设，不能把全部失败都归因于产品实现。
- 基础适配后，旧版全量 1872 项通过；新增 native 边界测试分别在两个版本通过。
- 新版针对初始化/恢复的 10 项 native 测试中 5 项通过：包括工作台恢复及随后实际 fixture Agent 请求、导入后请求。剩余失败含 request.system 和 stream fixture 变化，以及 assistant replacement 真问题。

最后一次官方新版全量结果：1872 项，1849 通过，23 失败（Token Meter 后续修复尚未计入此全量数字）。

## 阻塞一：assistant replacement 的来源规则相互冲突

发布包 `@deepseek-ai/dsh-session/lib/index.js` 的 assertProvenance 同时规定：

1. assistant/message 不能携带 sourceEventSeqs。
2. replacement 必须以 sourceEventSeqs 覆盖每个被替换的 surface 节点。

对一个已有 assistant 节点做原生替换，两种写法均被拒绝：

```
replacement true assistant/message embeds its source stream and cannot carry sourceEventSeqs
replacement false surface replace: sourceEventSeqs must include every shadowed surface node; missing 0
```

尚未发现保留原有 assistant 语义的公开替代接口。不能把 assistant 塞入 user/message 当作修复。

临时实验：只将上述禁止引用条件限定到 append 后，带引用的 replacement 成功，body-editor-native 的磁盘恢复和下一次 Agent 请求测试通过。实验已撤销，没有将补丁加入安装器或用户 runtime。先清空为 user 再追加 assistant 的方案会额外留下 user 消息，不能视为语义等价。分发修补版 DSH 属于维护范围变化，等待用户决定。

## 阻塞二：旧 Session 的开场上下文无法通过官方迁移

Tavern 在首次 step/start 前写入卡片上下文和合成开场。V2→V3 的官方 stage 对这种前置 surface 事件报错：

```
format v2 surface before first step cannot acquire a system head without changing chronology
```

最小复现只含 V2 header 和第一条 plugin user/message。这证明该事件形态不受支持，尚未在用户真实历史上尝试迁移。不能通过直接改 header.version 或插入旧 seq 来迁移。

## 可运行复现

```
node scripts/repro-dsh-015-session.mjs /absolute/path/to/dsh/node_modules/@deepseek-ai
```

只创建内存 Session，不读取或修改用户数据。输出两个 assistant replacement 结果及迁移结果。此脚本用于研究，不计入默认回归测试。

## 后续取舍

用户决定不发布上游 issue，复现只保留本地。等待官方澄清或修复后，再完成全部 native 回归和旧存档副本迁移验证。另一选择是维护 Tavern 专用 DSH fork；这增加上游补丁和迁移契约维护责任，需要单独确认。当前没有修改上游、发 issue 或删减酒馆功能。

## 上游资料

- [0.1.5-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [V2→V3 迁移规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.zh.md)

发布说明不完全等同于包 API：实装 ctx.sessions.get/flush 仍存在，未按说明盲目重写生命周期。
