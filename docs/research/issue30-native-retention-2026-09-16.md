# #30 本地真实宿主后台实例回收实测

2026-09-16，本地验证 `526fc13`。旧版基线取自 `6fe9243`。

## 方法与边界

使用本机 DSH Desktop 安装包中的 Agent、Session、Agent loop 和工具服务，在独立 Node 进程、临时存档目录中启动。`dsh-agent` 版本为 `0.1.2-alpha.1`。未重启 Desktop，未读取或改动用户存档，未调用付费模型。

调用生产 `createBackgroundAgentSessions` 和 `createBackgroundAgentTask`，使用本地确定性模型完成任务。通过正式的 `needsNewBackgroundSession` 接口连续触发 12 次替换；每个实例追加 1500 条原生事件，每条携带独立随机生成的 2048 字节文本。测试记录不保留 Session/Agent 强引用，模型请求记录在每轮采样前清空。

这验证了生产后台所有权模块在真实宿主组件上的回收行为；没有启动完整 Desktop UI、完整 Tavern 插件或真实人物卡脚本，也没有复现真实压缩/回退触发替换的整条流程。因此不是群友环境的整体 RSS 复现，不能证明 #30 的所有内存问题都已解决。

## 结果

12 次替换结束时：

| 条件 | 旧版 | 修复后 |
|---|---:|---:|
| 插件持有后台实例 | 12 | 1 |
| 宿主 Agent 注册表中的后台实例 | 12 | 1 |
| 宿主 Session 注册表中的后台实例 | 12 | 1 |
| 显式 GC 后 JS 堆 | 70.9 MiB | 29.5 MiB |
| 显式 GC 组 RSS | 165.5 MiB | 132.7 MiB |
| 不强制 GC 组 JS 堆 | 79.4 MiB | 57.5 MiB |
| 不强制 GC 组 RSS | 166.5 MiB | 150.0 MiB |

显式 GC 组的初始堆均约 24.3 MiB；第一轮均约 28.6 MiB。第 6 轮旧版约 47.8 MiB，修复后约 29.0 MiB。修复后并未随替换次数保留所有旧历史。

模块退出后，两版的后台 Agent/Session 注册表均为零；显式 GC 后堆均回到约 29.4 MiB。RSS 并未立即下降，说明不能仅凭 RSS 不降判断实例释放失败。

数值是每种条件单次受控运行的采样，不是统计分布或生产内存预算。显式 GC 用于观察仍被引用的对象；日常运行以自然 GC 组作辅助参考。

## 重跑

在仓库根目录运行；可通过 `DSH_BOOT_MODULE` 指向其他已安装的 DSH 宿主。

```sh
git show 6fe9243:tavern-plugin/lib/background-agent-sessions.js > tavern-plugin/lib/background-agent-sessions-probe-old.js
node --expose-gc tests/fixtures/background-retention-native-probe.mjs old
node --expose-gc tests/fixtures/background-retention-native-probe.mjs fixed
node tests/fixtures/background-retention-native-probe.mjs old
node tests/fixtures/background-retention-native-probe.mjs fixed
rm tavern-plugin/lib/background-agent-sessions-probe-old.js
```

逐轮数据保存在同目录 `issue30-native-retention-2026-09-16.json`。脚本重新运行的结果写到 `/tmp/retention-native-*.json`。

## 空闲后台释放补充验证

后台所有权模块新增默认 5 分钟空闲释放与 8 个常驻实例上限；超限时优先释放最久未使用的空闲实例。运行、排队和压缩中的任务受保护，因此繁忙时可以暂时超过上限。释放前等待 Session 保存成功；保存或释放失败保留引用，至少 60 秒后重试。

释放只移除内存实例和请求引用，保留父会话到后台 Session ID 的映射以及磁盘历史。新任务与同一父会话的回收串行，释放中的新任务等待回收结束，再恢复原 Session。

`tests/background-agent-idle.test.mjs` 覆盖空闲期限、LRU、任务与释放交错、运行/压缩保护、保存失败退避及自动定时释放。`tests/background-agent-idle-native.test.mjs` 使用本机 DSH 和真实 JSONL 持久化，验证释放后宿主 Agent/Session 注册表均不再持有该后台；下一任务恢复相同 ID，且模型请求保留释放前的历史。该验证使用临时数据和本地模型。

这些限制仅覆盖 Tavern 持有的后台实例，不是宿主全局会话缓存策略，也不保证整个 Desktop 的 RSS 低于某个数值。
