# Issue 19：长对话输入卡顿

关联：[#19](https://github.com/flizzywine/dsh-tavern/issues/19)。本次只修复已复现的渲染开销，没有引入虚拟滚动、隐藏历史或改变模型上下文。

## 复现与结果

Apple M1 / 16 GiB / macOS，Playwright Chromium，1440×1000，原生测量不降速。DSH 0.1.2-rc.1、Tavern 1.7.0。空数据目录导入 365 条合成中文 Markdown，正文约 2.70 MiB，无 iframe、脚本、图片或模型调用。

宿主有历史分页；初次打开仅挂载末尾约 17 轮。点击十次“加载更早”后，365 条正文对应 914 个消息流节点、14,585 个 DOM 元素。流节点还包括上下文和轮次状态，不能当作消息条数。

同一会话、相同内容和操作（输入30个字母后清空，上下各滚动30次）：

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 最慢单字符输入操作 | 1060 ms | 48 ms |
| 主线程最长任务 | 1053 ms | 无超过50 ms的长任务 |
| 样式重算累计 | 1939.6 ms | 69.6 ms |
| JavaScript 执行累计 | 248.7 ms | 260.5 ms |
| DOM 元素 | 14,585 | 14,585 |

输入时间包含 Playwright 命令往返，不是标准 INP。修复前恢复原 CSS 再测仍有961 ms输入停顿；未使用临时删规则的结果冒充修复后数据。

## 原因与修复

Tavern 的首页与开场白预览样式使用了祖先 `:has(...)` 后接通配子元素 `> *` 的规则。关系匹配让原本与游戏输入无关的界面样式参与长消息树的重算；即使首页、选卡窗口没有显示，仍会造成开销。分组动态删规则只能提供线索，最终以重新加载修复文件后的页面测量为准。

- 首页状态在 native Conversation 根节点的创建、phase及结构变化时派生，写成明确的 CSS class。正文流式更新与输入编辑不扫描历史。
- 空白 Session 有顶栏，继续保留输入框；无 Session 的首页保留品牌占位。根节点替换与插件卸载会清理标记和观察器。
- 开场白预览子元素的 `flex-shrink:0` 直接声明；普通块布局下该属性不影响排版，无需先查询预览后代。
- 日志按钮样式随导出组件挂载、卸载，因此去掉冗余的 `body:has(...)` 条件。
- 更新样式资源版本，避免旧 CSS 配新客户端。

## 验证

```sh
node bin/test-tavern.mjs
node tests/fixtures/long-conversation-browser-smoke.mjs
node tests/fixtures/long-conversation-native-perf.mjs STATE_JSON CONNECTION_JSON OUTPUT_DIR --navigation
```

完整测试：2025通过，无失败或跳过。浏览器回归包含首页、空白会话、延迟挂载输入框、根节点替换、清理、预览布局，以及活跃输入不扫描对话后代。

小型浏览器回归以17,905个DOM元素、4倍CPU降速测量：旧CSS的样式重算中位数66.2 ms，超过20 ms预算而失败；修复后约0.04 ms。可用 `TAVERN_PERF_CSS` 指定旧CSS文件、`TAVERN_PERF_SKIP_INSTALLER=1` 重放旧实现。

原生脚本需要独立合成会话：STATE_JSON 是 `{url,state}`（state来自Playwright storageState），CONNECTION_JSON 是测试服务的 `{url}`，输出目录必须已存在。脚本不会发送消息，但会填入并清空草稿，不要指向实际游玩会话。它确认测试卡名和全部历史挂载后才测量。

## 边界

这是合成普通正文的复现，不替代反馈者 Windows/Edge、原人物卡和 iframe 脚本的实测。逐页加载全部历史仍耗时约96秒，尚未定位该加载路径；本次解决已加载页面的交互停顿，不宣称解决所有长历史问题。
