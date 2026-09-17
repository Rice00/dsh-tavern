# TauriTavern 性能实现参考

检查日期：2026-09-14。源码固定到 `9693a4ec47cd4552f90878bccab453f176de0f18`。只做源码与针对性测试检查，未运行完整 Tauri 应用、未修改 DSH 实现。

## 结论

值得借鉴的是限制消息 DOM、限制嵌入运行时并发、昂贵操作分帧及启动关键路径分层。无需因此改用 Rust/Tauri。当前聊天虚拟化默认关闭，文档标为 experimental bounded；不能把 README 的流畅描述当成跨设备基准结论。

## 聊天 DOM 与数据分离

完整 chat[] 仍是前端数据来源，虚拟化只改变挂载消息集合，不裁剪模型历史或落盘内容。TanStack virtual-core 3.17.7 提供动态高度几何，视口附近最多 32 条，另保留真实末条，总消息 root 上限 33。不是 React Virtual DOM diff，也不是历史数据分页；完整 JSONL 读取、解析和内存仍随聊天增长。

结构变化与纯滚动投影分离；动态高度变化保存消息 key 和楼内偏移，底部跟随是另一种明确意图，避免图片加载后跳动。静态显示与有副作用的脚本必须分开看待。

[数据与所有权约定](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/docs/FrontendGuide.md#L130-L156)；[窗口常量](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/tauri/main/kernel/chat-surface/virtualization-config.js)；[滚动锚点](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/tauri/main/services/chat-surface/bounded-chat-surface.js#L145-L256)

## 嵌入脚本预算

managed 模式默认最多激活 8 个 runtime candidate，每动画帧激活一个，按 visible/overscan 需求撤销和重新授予运行资格。挂载、内容与运行资格有独立清理生命周期。扩展必须支持 participant 协议，缺失会明确报错。因此它不是对任意旧卡脚本完全透明的加速开关。

[调度与上限](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/tauri/main/services/chat-surface/runtime-admission.js#L5-L176)；[扩展能力检查](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/tauri/main/services/chat-surface/capability-gate.js)

## 昂贵装饰工作分批

代码高亮接近视口时触发，按需加载库，idle callback 或动画帧执行；每批约 8ms 后让出主线程。正则刷新也有 8ms 批次预算。预算在单项操作后检查，并不能中断一条特别慢的正则或高亮。

[高亮队列](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/scripts/tauri/perf/code-highlight-coordinator.js#L25-L128)；[正则刷新](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/scripts/tauri/perf/regex-refresh-coordinator.js#L230-L253)

## 启动

Shell/Core/Full 分阶段：先显示壳，等待 host readiness 后读取 bootstrap 快照，应用核心设置/角色/群组等，再完成 APP_READY。分词器、抓取器及部分第三方扩展后移；不能后移聊天虚拟化需要的 renderer 依赖。bootstrap 后端并发读取五类首屏数据，前端复用快照，避免重复请求。分阶段改变关键路径，但 Shell 本身仍在主模块静态依赖求值后，不代表极小首包；APP_READY 也不保证上次聊天已经加载完毕。

[实际启动入口](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/script.js#L1042-L1235)

## 本次验证

运行 chat-surface-bounded、virtual-adapter、runtime-admission、controller、kernel、chat-virtualization-state 六个测试文件：40 项全部通过。包含 10,000 条消息下挂载数量限制、跳转、锚点、追加和运行资格回收。测试采用 fake DOM 和真实 virtual-core，验证契约而不是浏览器布局耗时、帧率或真实 WebView 性能。启动预取测试另有 3 项通过；未找到已提交的启动前后基准报告。

[万条消息测试](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/tests/chat-surface-bounded.test.mjs#L78-L132)

## 对 DSH Tavern 的建议

DSH Tavern 已有聊天窗口化代码（`src/client/modules/history-window.js`），不能以此前 issue #19 的旧记录判断当前尚未实现。本次不再提出新建窗口化。

1. 消息 iframe 已按视区延迟激活；此次将同时进入视区的首次激活排到不同帧，离开视区和卸载取消排队，eager 开场保持原就绪路径。不撤销已运行卡片脚本。
2. 正文分色此前每个文本节点重复检查祖先样式；此次在单次同步扫描内缓存样式与显式配色判断，后续 DOM/主题变化重新读取。1000 段合成正文从 14000 次样式读取降至 4000 次，高亮结果保持 4000 个范围。真实浏览器验证主题变化、作者配色、流式更新、开关和销毁均通过。
3. 不直接套用活动脚本数量上限：现有 Helper 包含 MVU/业务职责，离屏不应终止后台逻辑。进一步挂起运行时需要先建立可恢复的显示生命周期。
4. 当前已有开局预热和库加载延迟；本次没有证据要求重排宿主启动关键路径，未改启动时序或服务端正则语义。

本轮优化提交 `dbdeabe`。全量测试 2131 通过、4 跳过、1 个此前已复现的图片测试失败；新增组件生命周期测试另行通过。
