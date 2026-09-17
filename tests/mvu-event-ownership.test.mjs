import assert from 'node:assert/strict'
import test from 'node:test'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('真实 Helper 异步 MESSAGE_RECEIVED 回调携带结算身份，迟到重放立即回传错误码', async () => {
  const chat = { id: 'c', sessionId: 's', mode: 'story', cardPath: 'card', mvu: { enabled: true }, tavernHelperLifecycleRevision: 2,
    messages: [{ role: 'assistant', text: '正文', swipeId: 0, swipes: ['正文'], variables: [{ stat_data: { hp: 10 }, schema: {} }] }] }
  let helper, adapter, workId, seenCode
  const calls = [], writes = []
  adapter = createTavernScriptHostAdapter({ resolveChat: async () => structuredClone(chat), writeChat: async value => writes.push(value),
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { async dispatch(_session, name, args, context, work) {
      workId = work.eventId
      helper.receive({ type: 'dsh-tavern-helper-context', context })
      helper.receive({ type: 'dsh-tavern-helper-event', name, args, eventId: workId })
      for (let i = 0; i < 10; i++) {
        await tick()
        const receipt = helper.sent.find(row => row.type === 'dsh-tavern-helper-event-complete' && row.eventId === workId)
        if (receipt) return { handled: !receipt.error, args: receipt.args, error: receipt.error }
      }
      throw new Error('事件没有及时返回完成回执')
    } } })
  helper = helperHostHarness(await adapter.context('s'), { onCall(call) {
    if (call.type !== 'dsh-tavern-helper-call') return
    calls.push(call)
    queueMicrotask(async () => {
      try {
        assert.equal(call.method, 'updateTavernHelperVariables')
        const result = await adapter.updateVariables('s', call.args.option, call.args.variables, call.lifecycleRevision, call.eventId, call.args.contextBaseline)
        helper.reply(call, result)
      } catch (error) {
        helper.receive({ type: 'dsh-tavern-helper-response', requestId: call.requestId, ok: false, error: error.message, errorCode: error.code })
      }
    })
  } })
  helper.window.eventOn('MESSAGE_RECEIVED', async () => {
    await Promise.resolve()
    const variables = helper.window.getVariables({ type: 'message', message_id: 0 })
    variables.stat_data.hp--
    try { await helper.window.replaceVariables(variables, { type: 'message', message_id: 0 }) }
    catch (error) { seenCode = error.code; throw error }
  })
  const result = await adapter.settleMvuUpdate({ operationId: 'op', sessionId: 's', messageId: 0, swipeId: 0,
    expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
  assert.equal(result.updated, true)
  assert.equal(result.context.messages[0].variables.stat_data.hp, 9)
  assert.equal(calls[0].eventId, workId)
  assert.equal(writes.length, 0)
  assert.equal(chat.messages[0].variables[0].stat_data.hp, 10)
  helper.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', args: [0], eventId: workId })
  for (let i = 0; i < 3; i++) await tick()
  const failure = helper.sent.filter(row => row.type === 'dsh-tavern-helper-event-complete' && row.eventId === workId).at(-1)
  assert.equal(seenCode, 'MVU_SETTLEMENT_EVENT_MISMATCH')
  assert.equal(failure.errorCode, seenCode)
  assert.match(failure.error, /不属于当前 MVU/)
  assert.equal(writes.length, 0)
})
