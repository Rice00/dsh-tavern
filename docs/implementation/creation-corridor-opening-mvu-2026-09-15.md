# 创世回廊创建页 MVU 丢失

## 结论

v1.8 已包含开局草稿、官方 MVU 初始化和向导保存（e50a9a2、9b239bc）。反馈报告只看到静态预览层的 helperContext:null，遗漏了 getCardOpenings 后续添加的 preparation.runtime，因此“开局没有 MVU”的整体判断不准确。

但现象成立：本地创世回廊5.2 的封面显示 MVU 就绪，切换到 RPG 角色创建页后，当前页面及 parent.Mvu 的读写接口缺失。

## 原因与修复

卡片的“开局”正则下载远端创建页，调用 document.open/write/close 替换整个文档。宿主使用延迟执行的 script type=module 标签启动模块；文档替换可在标签执行前将它移除，导致 bootstrap 提供的 Helper 仍在，但官方 MVU 尚未加载。

改为普通脚本立即发起动态 import，保留同一模块求值、依赖等待和串行加载机制，不添加替代 MVU。

## 验证

- 真实 Chromium 使用正式 buildTavernFrameDocument 构建页面，通过延迟解析脚本稳定重现文档替换。修复前读取 MVU API 超时，修复后模块仅启动一次，读到预期数据。
- 原卡创建页修复后，当前 Mvu、parent.Mvu.getMvuData、parent.Mvu.replaceMvuData 均可用；能读取人物、世界信息、系统配置等初始化结构。
- 在独立开局草稿中通过上述真实 MVU 接口写入人物名称“兼容检查”，等待原生保存回执后读回一致。没有修改用户已有游戏。
- 本轮未生成职业技能树、未完成创建向导全部步骤，不宣称整张卡所有功能通过；验证范围是报告中的 MVU 初始化与保存通道。
