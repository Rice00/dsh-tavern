# 人物卡脚本的本地变量

人物卡共享脚本沙箱现在提供 `SillyTavern.getContext().variables.local`，以及同一个 `getContext().variables.local`。

```js
const local = SillyTavern.getContext().variables.local;
local.set('score', 2);
local.inc('score');
console.log(local.get('score')); // 3，可立即同步读取
await SillyTavern.getContext().saveMetadata(); // 等待宿主保存，失败时拒绝
```

支持 `get`、`set`、`has`、`del`、`add`、`inc`、`dec`。数值字符串读取为数值；不存在的变量读取为空字符串；`add` 支持数字累加、字符串拼接、JSON 数组追加。`get(name, {key, index})` 支持读取 JSON 字符串内的索引。`set` 的 `index/as` 选项尚未支持，会明确报错；请先读取并更新完整值。

数据使用现有的聊天变量存储，与 `getVariables({type: 'chat'})`、`insertOrAssignVariables(..., {type: 'chat'})` 互通。每次修改立即发起保存；连续单键写入按会话串行处理，不用旧的完整变量快照覆盖其他键。普通读取和 setter 返回值同步，持久化通过 `saveMetadata` / `saveChat` 等待确认；宿主派发的脚本回调也会等待自己的变量写入后才回执。保存失败会记录原脚本诊断并撤回本地临时值，等待保存的调用会得到异常。

范围是共享人物卡脚本沙箱，不代表已补齐消息 HTML iframe 的完整 SillyTavern Context，也没有新增 `variables.global`。本地变量随当前聊天和历史生命周期隔离，不新增另一份存储。

接口语义参考 [SillyTavern Context](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js) 和 [variables.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/variables.js)。
