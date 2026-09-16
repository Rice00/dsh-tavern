import test from 'node:test'
import assert from 'node:assert/strict'
import { compactionFailureMessage } from '../tavern-plugin/lib/domain/compaction-failure.js'
test('压缩外层通用错误保留内部超限分类，不暴露代理负载', () => {
  const inner = Object.assign(new Error('PRIVATE provider payload'), { code: 'CONTEXT_WINDOW_EXCEEDED' })
  const error = new Error('manual compaction could not produce a smaller summary', { cause: new Error('summary failed', { cause: inner }) })
  assert.match(compactionFailureMessage(error), /超出模型上下文窗口/)
  assert.match(compactionFailureMessage(error), /contextWindow/)
  assert.doesNotMatch(compactionFailureMessage(error), /PRIVATE/)
  const cyclic = new Error('普通失败'); cyclic.cause = cyclic
  assert.equal(compactionFailureMessage(cyclic), '普通失败')
})
