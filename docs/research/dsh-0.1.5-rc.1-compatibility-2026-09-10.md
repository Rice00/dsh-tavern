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

## 第一阶段隔离实测

本节记录升级本地服务之前的验证。独立临时 npm runtime、Profile、数据目录和 3185 端口；没有升级日常使用的私有 runtime，没有读取真实存档，也没有发送付费模型请求。

- 新 runtime 安装、依赖/interface 探测、dump-config、启动均成功。
- 实际浏览器可打开 Tavern，新建空白卡片工作台，看到开场与人物卡/预设/世界书/剧本资源侧栏。没有据此宣称完整游玩通过。
- 新版原始全量测试：1871 项，1823 通过，48 失败。失败包含真实协议变化及旧版测试 fixture 假设，不能把全部失败都归因于产品实现。
- 基础适配后，旧版全量 1872 项通过；新增 native 边界测试分别在两个版本通过。
- 新版针对初始化/恢复的 10 项 native 测试中 5 项通过：包括工作台恢复及随后实际 fixture Agent 请求、导入后请求。剩余失败含 request.system 和 stream fixture 变化，以及 assistant replacement 真问题。

该阶段官方新版全量结果：1872 项，1849 通过，23 失败（Token Meter 后续修复尚未计入此数字）。

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

临时实验：只将上述禁止引用条件限定到 append 后，带引用的 replacement 成功，body-editor-native 的磁盘恢复和下一次 Agent 请求测试通过。实验已撤销，没有将补丁加入安装器或用户 runtime。先清空为 user 再追加 assistant 的方案会额外留下 user 消息，不能视为语义等价。用户已明确不修改 DSH，不维护补丁版；该实验仅作为定位证据，不采用。

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


## 合并 main 后的手工验收（23:13—23:18）

合并提交 `433f7ae`，包含 main 的当前人物卡 avatar 上下文修复；两组新增测试均保留。用户授权将本地服务切到官方 0.1.5-rc.1 后，在端口 3081 手测。DSH 源码未修改。测试使用公开样例“灯塔小镇 · 雨夜来信”，创建进度分叉进行破坏性操作，不改用户其他故事。

| 功能 | 验证结果 | 范围与限制 |
| --- | --- | --- |
| 新开游戏与第一轮 | 通过 | 合并前已手测：开场、实际模型回复、MVU 状态更新 |
| 重启后的 V3 会话恢复 | 通过 | 合并后重启服务，正文、状态栏和模型选择恢复 |
| 从当前进度分叉 | 通过 | 保留原进度，新分叉正常打开 |
| 分叉后继续游玩 | 通过 | 第二轮实际回复约 9 秒；位置、铜钥匙和任务线索更新，后台结算完成 |
| 前后台手动压缩 | 通过 | UI 确认前台压缩 11 条约 845 tokens；后台 8 条约 5070 tokens。未单独验证压缩后正常续玩（随后进行了失败的编辑实验） |
| 回退本轮 | 失败 | UI 报 assistant/message 来源引用错误；正文仍保留。未宣称所有后台副作用均完成恢复 |
| 编辑正文保存 | 失败，且留下不一致 | 保存报相同错误；刷新后却显示编辑文本；再发送新行动报 UNKNOWN 和同一引用错误 |
| 重新生成 | 尚未独立手测 | 源码复用 assistant replacement，同样高风险；不能把源码判断标为手测失败 |
| 旧格式历史恢复 | 已有实际失败证据 | 本地旧 v0 会话被迁移器以 source.fixedSystemText 未知字段拒绝；原日志保持原样 |
| 桌面/Android | 未验收 | 本轮为 macOS CLI，不代表 Windows Desktop 或 DSHA 通过 |

### 优先级与所有权

1. **P1：编辑失败后不能继续游玩。** `body-editor.js` 先通过 Chat journal 提交 body.edit，再 synchronizeBodyEdits 写 Session；V3 拒绝写入后保留待同步编辑。新请求再次尝试同步时重复失败。这是 Tavern 事务恢复边界需要处理的问题，不能只改按钮或吞掉错误。本次仅复现与记录，没有削减功能或改写失败测试分叉的数据。
2. **P1：正文替换协议。** 编辑、回退、重新生成、后台 rewind，以及前台正文处理后 replaceAssistantReply 都使用 assistant replacement。应逐条确认原生语义；不以修改 DSH 或把正文伪装为 user 消息解决。
3. **P1：存档迁移。** 既有 V0 扩展字段和 V2 首步前种子均存在拒绝路径；升级前备份不能代替实际可用迁移方案。不得按新开游戏成功宣称升级兼容。
4. **P2：测试 fixture 与诊断。** 旧测试的 start/end、无 stream assistant、request.header.system 等假设需要区分于真实功能失败。一次全量失败数不等于相同数量的产品缺陷。
5. **P2：安装可重复性。** 本地升级时 npm 镜像和官方源都曾解析到缺失的 rc.2 子依赖，最终使用此前已下载的未修改官方 rc.1 运行时完成测试。顶层包版本固定不等于全部间接依赖固定。

合并后官方 0.1.5-rc.1 全量测试：1873 项，1852 通过，21 失败。合并相关脚本 API 测试：17 项全通过。日志位于 `/tmp/tavern-015-merged-tests.log`（临时文件，非发布工件）。

本轮没有测试图片浏览器直连回退；前述方案尚未实现。保持默认兼容声明 0.1.2-rc.1，不发上游 issue，不推送分支。

## 继续手测与失败保护（23:21—23:30）

- 编辑正文：复现 Chat 已发布编辑而 Session 拒绝写入，后续请求持续失败。`fa99ed7` 在发布 Chat 编辑前，用原生 `Session.fromRestore(..., inheritedEventCount, 'detached')` 创建独立副本并试写。不能用 `Session.create` 恢复已有分叉的完整历史。
- 编辑修复后，在新的样例分叉保存测试文本，宿主仍拒绝，但正文保持原样；继续发送正常行动约 6 秒返回，MVU 后台完成并更新 3 项变量。此修复防止新失败污染，不修复之前已污染的测试分叉。旧版正文编辑相关测试 10 通过、2 跳过；新版拒绝保护及普通/分叉原生验证通过。
- 重新生成：独立实测失败。模型已返回新正文，Chat 已更新，随后 Session replacement 被拒绝；状态回到此前值，重启后显示后台结算中断。说明不能只把最终错误返回 UI。
- 重新生成保护：对 V3 在回退 Chat、取消结算、调用模型前，用原生独立 Session 副本验证 assistant replacement。拒绝则明确提示“当前 DSH 不支持正文替换，未启动重新生成”。这不是完整支持重新生成，也不是对已损坏数据的迁移修复。
- 修复后重启，浏览器再次点击生成并替换，立即返回上述提示；仍为 4 轮 4 步，正文与状态无新增变化。新版 round-history 测试 35 通过；旧版 33 通过、2 个 V3 专用测试跳过。

仍需解决：正文替换的完整原生语义（包括回退与后台 rewind）、旧历史迁移、此前失败留下的待同步编辑/不一致状态。默认推荐运行时不升级；以上没有修改 DSH。

## 预设与 V3 系统消息适配

原生 Agent 的实际 LlmAdapter 输入证明：0.1.5 不再提供顶层 `system`，固定背景由来源为 `@deepseek-ai/dsh-system-prompt` 的 system 消息承载；存在开场种子时，该消息可在种子之后。Tavern 激活前段或后段预设时，原有角色归一化把非首位 system 降成 user，导致固定人物背景失去系统角色。两个新增回归用例在修复前失败。

修复只改 Tavern 请求投影：识别宿主原生 system 消息，放到预设前段之后、普通历史之前，再归一化角色。不开启预设保持原请求；普通中途 system 注记沿用原规则；不更改 Session 事件和原请求对象。

验证：新旧两套运行时各 17 项通过，包含真实 Agent + 脚本 LlmAdapter 的前段/后段预设请求、固定背景唯一性、开场恢复、导入后请求及导入后原生压力压缩。相关编排/预设/背景回归 46 项通过。测试修正使用正式事件边界处理 V3 坐标和 assistant stream，并按两种宿主实际系统消息结构断言，未跳过真实协议失败。这里验证到 LlmAdapter 输入，不宣称独立远程服务商 HTTP 验证。

对正文替换重新运行最小复现，两个来源规则仍相互冲突。当前正式 Surface 操作没有 assistant 删除/替换的另一入口。请求投影或自动分叉可作为后续设计研究，但会涉及 Surface 展示、模型历史与持久分支的一致性，不能当作无差别的小补丁采用。
