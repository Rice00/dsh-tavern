# Issue #45：无损快照压缩和缓存保留实测

基线：`d4934f259d7d270f254749ece133541bf82f3c36`。
本次不启用 MVU 历史变量删除，也不使用展示字符串 `delta_data` 重建状态。

## 选择及边界

变量宏会直接 JSON/YAML 序列化对象，键顺序变化也可能改变模型请求。因此采用文件边界的
标准 gzip（异步、level 1），避免引入变量差异重建和额外引用格式。64 KiB 以上的新快照
压缩为 `.json.gz`，小快照保持 `.json`；旧快照不重写，历史变量、swipe 和 revision 全部保留。

另一个开销来自首次保存和 journal 轮换后没有复用已物化的 Chat，下次读楼层切片必须重读完整
快照。这次保留该缓存，同时继续用所有相关文件的版本信息检测外部变化。轮换后清空 open
journal 指针，后续追加创建新段。

gzip 本身减少磁盘字节，不消除完整状态的序列化和克隆，也不会缩小完整前端 API 返回值。
旧快照和历史 journal 仍保留，所以不能把下表的压缩率理解为已有聊天目录立即缩小的比例。

## 方法

macOS、Node v22.22.0。225 / 600 层合成聊天，每层保存 100 个人物的完整变量，变化一项数值，
带中文正文、schema 和 delta 展示字段。数据不是 issue 报告者的私人存档。

对同一 fixture 比较基线和修改后实现，交替执行，每组一次预热、七次计量，报告中位数。
`frameLimit: 1` 强制轮换以测量该路径，不代表日常每次变量修改都会轮换。
首次创建后执行完整 update 并轮换、读取末层切片、重新创建 store 读取完整 Chat，再执行
patch 并轮换、读取末层切片。每轮校验新 store 返回完整 Chat 的序列化字符串一致。
“重新打开”只清除应用 store 缓存，没有清除操作系统文件缓存。测试期间不并行运行全量测试。

## 结果

时间单位 ms；体积使用十进制 MB。详细原始指标见同名 JSON 文件。

| 指标 | 225 层基线 | 225 层优化后 | 600 层基线 | 600 层优化后 |
| --- | ---: | ---: | ---: | ---: |
| 单份快照体积 | 6.561 MB | 0.423 MB | 17.495 MB | 1.123 MB |
| 首次创建 | 50.148 | 47.083 | 117.918 | 115.271 |
| 紧接首次创建的完整 update + 轮换 | 121.103 | 88.295 | 328.749 | 217.725 |
| 轮换后读取末层切片 | 37.247 | 0.389 | 99.151 | 0.395 |
| 新 store 读取完整 Chat | 45.180 | 50.455 | 132.290 | 133.208 |
| 热缓存 patch + 轮换 | 27.839 | 25.686 | 55.880 | 53.084 |
| patch 轮换后读取末层切片 | 37.459 | 0.252 | 100.323 | 0.288 |

新快照减少约 94% 的磁盘写入字节。明显的读取收益来自避免轮换后的整份物化，
不是解压比 JSON 解析快。225 层重新打开增加约 5.3 ms；600 层基本持平。
首次创建和单独的热缓存轮换写入耗时没有数量级改善。

## 正确性与上下文缓存

- 完整 Chat 压缩往返后 JSON 字符串一致，覆盖非字母序键、数字键、嵌套数组、null、Unicode 和备用 swipe。
- 使用生产变量宏及 compatibility request 模块，验证 JSON/YAML 宏和请求序列化字节一致；未更改提示词编译、消息顺序或上下文缓存参数。
- 重启、跨格式 journal、逐 revision 恢复、外部文件更新失效，以及返回对象隔离通过。
- gzip 截断、CRC 错误、非法 JSON 能回放恢复；缺少连续历史时拒绝返回旧状态。
- 普通/压缩快照在创建、迁移、轮换的 staging 阶段杀进程后可恢复。
- 全量：2564 通过、5 跳过、0 失败；没有调用真实 LLM，也未测量供应商的实际缓存命中率。

## 复现

在仓库根目录执行（临时目录用于放置基线模块及其相对依赖）：

```sh
baseline_dir=$(mktemp -d)
git show d4934f259d7d270f254749ece133541bf82f3c36:tavern-plugin/lib/domain/chat-journal-store.js > "$baseline_dir/chat-journal-store.mjs"
git show d4934f259d7d270f254749ece133541bf82f3c36:tavern-plugin/lib/domain/json-mutation.js > "$baseline_dir/json-mutation.mjs"
sed 's|./json-mutation.js|./json-mutation.mjs|' "$baseline_dir/chat-journal-store.mjs" > "$baseline_dir/baseline.mjs"
node bin/benchmark-chat-snapshots.mjs "$baseline_dir/baseline.mjs"
node bin/test-tavern.mjs
```

基准脚本自行删除合成聊天临时目录；不会访问真实存档。
