import test from 'node:test'
import assert from 'node:assert/strict'
import { compactBackgroundIfNeeded, measureBackgroundBudget } from '../tavern-plugin/lib/domain/background-compaction.js'

function harness(pressure) {
  const calls = []
  return { calls, options: {
    pressure: async () => pressure,
    mark: async () => { calls.push('mark') },
    forced: async () => { calls.push('compact'); return { summary: 'shortened' } }
  } }
}
test('candidate request reserves output: 705015 + 384000 exceeds 1048576', async () => {
  const h = harness({ inputTokens: 705015, outputTokens: 384000, capacity: 1048576 })
  await compactBackgroundIfNeeded({ ...h.options, trigger: 'pressure' })
  assert.deepEqual(h.calls, ['mark', 'compact'])
})
test('provider-confirmed overflow recovers even when local estimation was low or missing', async () => {
  for (const pressure of [null, { inputTokens: 10, outputTokens: 10, capacity: 1048576 }]) {
    const h = harness(pressure)
    await compactBackgroundIfNeeded({ ...h.options, trigger: 'context-overflow' })
    assert.deepEqual(h.calls, ['mark', 'compact'])
  }
})
test('ordinary background work below budget keeps its history', async () => {
  for (const pressure of [null, { inputTokens: 100000, outputTokens: 384000, capacity: 1048576 }]) {
    const h = harness(pressure)
    assert.equal(await compactBackgroundIfNeeded({ ...h.options, trigger: 'pressure' }), null)
    assert.deepEqual(h.calls, [])
  }
})
test('failed rewind protection persistence prevents compaction', async () => {
  const h = harness(null)
  await assert.rejects(compactBackgroundIfNeeded({ ...h.options, trigger: 'context-overflow', mark: async () => { throw Error('disk failure') } }), /disk failure/)
  assert.deepEqual(h.calls, [])
})

test('budget uses the current model, explicit output reservation and uncommitted task messages', async () => {
  const header = { config: { provider: 'old', model: 'old' }, system: 'stable', tools: [] }
  const pending = { content: [{ type: 'text', text: 'new candidate task' }] }
  const options = {
    agent: { session: { requestHeader: () => header } },
    background: { selection: { provider: 'current', model: 'v4' }, maxTokens: 384000 },
    llm: { resolveModelInfo: async (provider, model) => {
      assert.equal(provider, 'current'); assert.equal(model, 'v4')
      return { context: { contextWindow: 1048576 }, defaultMaxTokens: 8192 }
    } },
    meter: {
      measure: (_session, envelope) => {
        assert.equal(envelope.config.model, 'v4'); assert.equal(envelope.system, 'stable')
        return { totalTokens: 700000 }
      },
      estimateMessage: message => { assert.equal(message, pending); return 5015 }
    },
    pending: [pending]
  }
  assert.deepEqual(await measureBackgroundBudget(options), { inputTokens: 705015, outputTokens: 384000, capacity: 1048576 })
  assert.equal(header.config.model, 'old')
  delete options.background.maxTokens
  assert.equal((await measureBackgroundBudget(options)).outputTokens, 8192)
  options.llm.resolveModelInfo = async () => ({})
  assert.equal(await measureBackgroundBudget(options), null)
  options.llm.resolveModelInfo = async () => { throw Error('metadata unavailable') }
  assert.equal(await measureBackgroundBudget(options), null)
  options.signal = AbortSignal.abort()
  await assert.rejects(measureBackgroundBudget(options), /metadata unavailable/)
})
