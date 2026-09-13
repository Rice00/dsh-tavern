# MVU 长历史同步性能排查

2026-09-14。反馈缺少发生步骤、存档和平台；尚未复现反馈者的整体卡死。初始排查未修改生产逻辑；后续优化见末节。

## 已测范围

执行 `node tests/fixtures/mvu-context-performance.mjs`：浏览器内运行实际 Helper 投影、差异生成和差异应用函数，使用完全合成数据。每轮一条用户和一条助手消息，助手保存固定大小变量快照；最后一条仅修改一个字段。四次测量，取后三次中位数。不是完整 DSH UI，也没有运行 MVU 核心解析、网络和人物卡脚本。

| 轮数 | 单轮变量 | Helper 上下文 | 比较历史 | 应用增量 |
|---|---|---|---|---|
| 80 | 无 | 0.93 MiB | 0.8 ms | 0.8 ms |
| 80 | 64 KiB | 10.94 MiB | 7.7 ms | 8.3 ms |
| 80 | 256 KiB | 40.94 MiB | 38.2 ms | 34.7 ms |
| 200 | 无 | 2.34 MiB | 1.8 ms | 1.6 ms |
| 200 | 64 KiB | 27.35 MiB | 21.1 ms | 24.1 ms |
| 200 | 256 KiB | 102.35 MiB | 93.7 ms | 106.2 ms |

数值只代表本机合成测试。先前通过自动化协议传输巨型数据的测量页曾关闭；改为浏览器内生成数据后完成测量，不能将前一次关闭当成产品崩溃证据。

## 源码证据

- `tavern-helper-context.js/projectTavernHelperContext` 投影所有历史消息，同时复制 swipes_data 与选中的 variables；同一变量快照在 JSON 中出现两份。
- `main.js/createTavernHelperContextUpdate` 每次比较所有历史消息，对消息执行 JSON.stringify；虽然最终发送 patch，计算 patch 仍与总历史大小有关。
- `main.js/applyTavernHelperContextUpdate` 收到 patch 后先 JSON 深拷贝整个旧上下文，再应用变化；更新一个字段仍复制全历史。
- `buildTavernFrameDocument` 把 Helper 上下文写入 iframe 初始文档。历史消息 Frame 冻结自己的上下文，不能笼统说每轮所有历史 iframe 都持续更新；但已挂载 Frame 的初始化与内存占用仍需完整 UI 测量。

## 判断与后续

已确认 Tavern 的 Helper/MVU 同步存在随历史数据量放大的开销；不能据此认定官方 MVU 核心本身慢，或保证这就是反馈者唯一原因。

本地仅查看落盘快照的匿名尺寸统计，47 个有变量的 MVU 样本中，最长快照也仅 25 条消息，多数变量为几 KiB，不能替代反馈者 80 轮存档；上表 64/256 KiB 是压力档位。

建议优先验证局部复制替代全量深拷贝，再减少重复历史比较。协议去重和历史按需读取属于更大改造，需要保留 getChatMessages、历史变量读取、回退及多 swipe 语义，不能直接删除历史变量。下一步应拿一份可复现长存档，记录打开、滚动、结算时的 CPU/内存/iframe 数和状态同步大小，确定主要阶段。


## 第一阶段优化：局部复制应用增量

`applyTavernHelperContextUpdate` 改为只复制上下文外层和消息数组；未变消息保留内部引用，被替换及追加的消息继续深拷贝，快照恢复继续完整复制。不删历史、不改协议。回归测试验证未变历史不被读取、替换/追加/截断不修改旧视图、输入 patch 后续修改不污染已应用值。

同机同一浏览器测量脚本复测（合成数据）：80 轮 / 256 KiB 的 apply 从 34.7 ms 降至 0.4 ms；200 轮从 106.2 ms 降至 0.3 ms。两次独立运行的近似比较，不是完整页面提速比例。全部历史比较仍约 35.1 / 83.1 ms，数据传输和初始 iframe 状态体积未改变。

验证：`node --test tests/inline-message-renderer.test.mjs tests/helper-context-refresh.test.mjs`，86 项通过；浏览器基准覆盖 20/80/200 轮与 0/64/256 KiB 状态。
