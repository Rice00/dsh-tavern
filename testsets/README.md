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

人物卡快照仅用于首次导入；后续直接使用该案例测试 Profile 中已有的卡，通过正式界面新开游戏。运行前校验的是导入种子快照，报告另记录实际使用卡片的哈希；修改过的测试卡不会被种子覆盖。新 checkout 需要补齐本地卡片及来源文件。运行环境与断言说明见 [自动化测试说明](./GUIDE.md)。

通用示例：`pnpm test:play testsets/examples/all-agents.yaml`。

运行器单元测试：`node --test testsets/tests/*.test.mjs`，也包含在项目 `pnpm test` 中。

同一案例不能同时运行。测试 Profile 按场景文件绝对路径区分，保存在 `testsets/profiles/`；正式玩家存档不受影响。需要重置时，在测试停止后删除对应 Profile 目录（路径见报告 `profileHome`），下次重新导入。异常退出留下的 `run.lock` 需确认运行器及其 DSH 子进程均已停止后再删除。

案例支持在一个 `play` 后连续写多个 `say`；第一个编号案例现为三轮。每轮等待前台和后台链路完成，成功和失败均保留输出、工具结果及运行事件；未执行的后续步骤会明确列出。
