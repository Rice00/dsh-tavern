# 真实游玩测试集

每个编号目录保存一份案例，统一复用 `testsets/test-play.mjs` 执行真实游玩，不另建 Agent 或模型调用链路。

```text
testsets/
  run.mjs                         # 编号案例启动与快照校验
  test-play.mjs                   # 通用场景运行器
  lib/                            # 浏览器、环境、证据、断言、拒绝判断
  tests/                          # 运行器单元测试
  examples/                       # 多 Agent、三轮游玩、拒绝标记示例
  GUIDE.md                        # 完整使用说明
  001-duan-yingying-continue/
    scenario.yaml                 # 模型、推理强度、输入、预期
    card.json                     # 本地人物卡快照（不提交）
    card.source.json              # 来源与快照哈希（不提交）
    README.md                     # 案例说明
  profiles/                       # 按案例持久复用的测试 Profile（不提交）
  results/                        # 每次运行的输出与日志（不提交）
```

检查配置，不调用模型：

```sh
node testsets/run.mjs 001-duan-yingying-continue --check
```

执行案例，产生真实模型请求：

```sh
node testsets/run.mjs 001-duan-yingying-continue
```

支持向现有运行器传递 `--headed`、`--runtime-home PATH`、`--output PATH`。结果默认写入 `testsets/results/案例编号/run-*/`，包含实际 Agent 输出、拒绝标记、原生日志、每步存档快照及截图。

使用 `sourceCard` 的案例在每次启动前同步正式卡库的最新 JSON，不需要本地导出快照。使用 `card` 的案例仍以快照仅用于首次导入；后续直接使用该案例测试 Profile 中已有的卡，通过正式界面新开游戏。运行前校验的是导入种子快照，报告另记录实际使用卡片的哈希；修改过的测试卡不会被种子覆盖。只有使用本地 `card` 的编号案例需要补齐卡片快照及来源文件。运行环境与断言说明见 [自动化测试说明](./GUIDE.md)。

通用示例：`pnpm test:play testsets/examples/all-agents.yaml`。

运行器单元测试：`node --test testsets/tests/*.test.mjs`，也包含在项目 `pnpm test` 中。

同一案例不能同时运行。测试 Profile 按场景文件绝对路径区分，保存在 `testsets/profiles/`；正式玩家存档不受影响。需要重置时，在测试停止后删除对应 Profile 目录（路径见报告 `profileHome`），下次重新导入。异常退出留下的 `run.lock` 需确认运行器及其 DSH 子进程均已停止后再删除。

案例支持在一个 `play` 后连续写多个 `say`；第一个编号案例现为三轮。每轮等待前台和后台链路完成，成功和失败均保留输出、工具结果及运行事件；未执行的后续步骤会明确列出。

## 查看报告

```sh
node testsets/report-ui.mjs
```

打开 <http://127.0.0.1:4318>，可搜索、筛选案例，逐轮查看前台回复、后台工具调用、拒绝标记与失败原因，并预览原始日志及截图。点击“刷新报告”读取最新结果。只监听本机，不调用模型。

可用 `--port 4319` 更换端口，`--results /绝对路径` 指定其他结果目录。UI 和服务代码分别位于 `testsets/ui/`、`testsets/report-ui.mjs`。

## 引用正式人物卡

```yaml
steps:
  - action: play
    sourceCard: 段莹莹_自由.json
```

文件名相对 `--runtime-home`（默认 `~/.dsh-tavern`）的 `profile-data/tavern/data/resources/cards/`。正式酒馆保存修改后，下次测试自动同步并新开游戏。无需 `card`、`cardName` 或手工更新哈希。测试副本会被覆盖，正式卡只读；同一次测试固定使用启动时的版本。来源与快照记录在报告中。
