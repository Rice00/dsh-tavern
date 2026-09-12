# 后台真实 Agent 测试

`test:play` 启动独立 DSH Profile 和无头 Chromium，通过正式页面导入人物卡、开局、发送、进入卡片工作台和生图。没有替代模型适配器、拼装提示词或模拟结算。运行会产生真实模型及图片服务费用。

## 运行

先安装项目开发依赖和浏览器，并准备已经配置模型凭据的 Tavern CLI：

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:play testsets/examples/avra.yaml
pnpm test:play testsets/examples/all-agents.yaml
```

`--runtime-home /path/to/.dsh-tavern` 指定已安装的 CLI；`--headed` 显示测试浏览器；`--output /path/to/results` 指定结果父目录。每次运行都创建新目录，成功退出码为 0，失败或中断为 1。

复用 CLI 的固定版本运行时、依赖和模型配置，插件链接当前 checkout；所有游戏数据、原生 Session 和生图产物写入测试专用 `home`。不会复制玩家存档。认证配置复制到该目录，目录权限限制为当前用户；完整目录应作为私人测试材料保管。测试结束关闭浏览器及本次 DSH，保留存档。

含 `image` 的场景复用指定 CLI 的 `scene-images/settings.json`、`providers.json` 和凭据，在测试副本中启用生图。请先通过正式设置完成渠道配置。失败不会自动重试图片请求。

## 场景

YAML 和 JSON 均可，文件路径相对场景文件解析。

```yaml
name: 简单测试
model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high
timeoutMs: 300000
tavernSettings:
  backgroundTasks:
    posture: true
    variables: true
    characterDesign: false
steps:
  - action: play
    card: ../../demo/cards/avra-before.json
  - action: say
    input: 我向阿芙拉点一杯热麦酒。
    expect:
      minChars: 30
      state:
        - path: settleStatus
          equals: done
  - action: say
    input: 我问她刚才那杯酒多少钱。
  - action: image
```

| 操作 | 含义 |
|---|---|
| `play` | 导入 `card` 并新开游玩；也可只给 `cardName`，使用本次测试库中已有或已修改的卡 |
| `card` | 新建卡片工作台；提供 `card` 时导入并打开修改任务，不提供时空白开始 |
| `say` | 向当前游玩或卡片工作台发送 `input`；可连续多轮 |
| `image` | 为当前最新正文点击真实生图按钮，等待图片保存并从正式图片接口读取 |

`expect.contains`、`expect.notContains` 接收字符串数组，检查正文原文；`expect.minChars` 检查长度，`expect.changedFiles` 检查指定资源文件确实新增或修改；`expect.state` 按点分隔路径检查落盘对象的 `equals`。游玩与卡片操作的 state 是 Tavern Chat；生图操作是图片记录。未知断言直接报错。

修改卡后接 `play: cardName`，可以验证修改是否真实影响新开的游戏。人物卡自身的世界书和脚本随正式导入流程运行。当前第一版不提供独立世界书绑定、切换开场、任意点击脚本和模型自动扮演玩家。

## 完成与证据

正文和卡片 Agent 使用原生 Session 的新 `turn/start` / `turn/end` 关联完成，不把某次工具响应或旧回合完成当成本轮完成。游玩还要等待本轮正文与后台结算写入 Tavern 存档，MVU pending 和失败回执均不通过。

每次运行生成：

- `report.md` / `report.json`：四类 Agent 的覆盖状态、各步耗时、断言、请求摘要及失败原因。
- `NN-chat.json`、`NN-native.json`、`NN-requests.json`：该步存档、原生执行事件、真实模型请求与输出。
- `NN-reply.md`、`NN.png`：正文和真实界面截图。
- 卡片任务的 `NN-resources.json`：修改前后文件哈希，以及报告里的新增、修改、删除路径。
- 生图的 `NN-image.json` 和 `NN-image.png`（扩展名随实际格式）：场景规划、图片版本记录和正式接口返回的图片字节。
- `home/profile-data/tavern`：完整原生存档，包括后台及生图子 Session，可继续诊断；`runtime.log` 为 DSH 启动日志。

失败保存 `failure-*` 证据并终止场景。未执行的 Agent 明确标为 `not-covered`，结算完成但未调用后台模型时标为 `not-invoked`；报告不会因为前台完成就推断生图或卡片成功。报告检查链路和明确断言，剧情质量仍须人工判断；通过一张演示卡不等于覆盖所有第三方卡、移动端或正式安装环境。

## 拒绝标记

报告把模型响应标成 **通过**（未发现拒绝信号）或 **未通过**（检测到拒绝），保留拒绝原文。网络错误、超时等标成 **执行异常**，不会当成拒绝。每个正文、后台、生图请求都单独记录；卡片 Agent 从真实原生回合输出提取。

默认 `expect.refused: false`。可以声明预期拒绝：

```yaml
continueOnFailure: true
steps:
  - action: card
  - action: say
    input: 你的测试 prompt
    expect:
      refused: true
```

`模型响应=未通过` 与 `测试结果=passed` 可以同时出现，表示模型确实拒绝且符合预期。`continueOnFailure: true` 让内容断言失败后继续后续 prompt；执行异常仍中止，避免在损坏状态下继续发送。

第一版采用明确拒绝句式和服务商 `content_filter` 等信号，不额外调用裁判模型。没有命中规则不保证不存在隐含拒绝，人物对白或引用也可能误判；应结合报告中的 `method`、拒绝证据和原文复核。可在场景顶层用 `refusalPatterns`（正则字符串数组）补充你的判定规则。

`refusal-markers.yaml` 是标记自检：让真实模型输出指定文本，故意产生一项不符合预期的拒绝，验证两种标记及继续执行；预期退出码 1。这是报告流程自检，不是模型安全拒绝率的测量。

## 本分支实测（2026-09-13）

- `avra.yaml`：真实 DeepSeek-V4-Flash 三轮正文、三次后台结算通过。
- `all-agents.yaml`：卡片 Agent 实际改卡并验证；两轮游玩中引用修改后的设定；两次后台结算；生图 Agent 经真实 Grok 图片服务生成并通过正式图片接口读取 JPEG。四类 Agent 均通过，原生后台/生图事件也已导出。
- `refusal-markers.yaml`：正常响应、故意不符合预期的拒绝、符合预期的拒绝，分别得到 `通过/passed`、`未通过/failed`、`未通过/passed`，且失败后继续执行。

以上覆盖演示卡、CLI 和桌面 Chromium；没有把它当成第三方 MVU 卡、移动宿主或模型拒绝语义识别准确率的验证。
