import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBackgroundAgentTask } from '../tavern-plugin/lib/background-agent-task.js'
import { createWorldbookFilter } from '../tavern-plugin/lib/domain/worldbook-filter.js'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { ensureSessionStablePrefix, readSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { backgroundSuppressedTurns } from '../tavern-plugin/lib/domain/background-surface.js'

for (const assistant of [false, true]) test('native background requests stay bounded across filter rounds and settlement; assistant=' + assistant, async () => {
  const session = Session.create('bounded-background')
  await ensureSessionStablePrefix(session, '固定人物卡')
  const task = createBackgroundAgentTask({})
  const state = { ctx: { tools: { register() { return () => {} } } } }
  const packets = []
  let pending, turn = 0
  const agent = { session, followup(message) {
    appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
    packets.push(session.deriveMessages())
    pending = (async () => {
      if (state.input.onToolCall) await state.input.onToolCall({ name: 'worldbook_filter_submit', arguments: { selected: [] } })
      turn++
      if (assistant) appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: {
        id: 'reply-' + turn, role: 'assistant', content: [{ type: 'text', text: '完成' }], source: { kind: 'model', provider: 'test', model: 'test' }
      } }, { surfaceOp: 'append' })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    })()
  }, async whenIdle() { await pending } }
  async function runAgent(input) {
    state.input = input
    return task.execute({ agent, state, traceSessionId: session.id, persistent: true }, input)
  }
  const filter = createWorldbookFilter({ runAgent, selection: () => ({ provider: 'test', model: 'test' }),
    beginTask: async () => ({ participantRequest: { sessionId: session.id, rewindTo: null }, bindSession() {},
      participant: run => run, commit: async () => ({ status: 'committed' }), fail: async () => {} }) })
  for (let i = 0; i < 12; i++) {
    // Newer fixed metadata appears after older task nodes: numeric cutoff is not enough.
    if (i === 6) await ensureSessionStablePrefix(session, '新版人物卡', undefined, 1)
    await filter({ chat: { sessionId: 'game', messages: [] }, userText: '输入' + String(i).padStart(2, '0'),
      candidates: [{ ref: 'entry', text: 'x'.repeat(88000), tokenCost: 22000 }] })
  }
  await runAgent({ task: 'settlement', rewindTo: -1, messages: [{ role: 'user', content: [{ type: 'text', text: '结算' }] }], tools: [], acceptWithoutText: () => true })
  const text = packet => packet.flatMap(m => m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  for (const packet of packets) assert.equal(text(packet).split('【最近剧情与本次任务】').length - 1, 1)
  const sizes = packets.slice(0, 12).map(packet => Buffer.byteLength(text(packet)))
  assert.equal(Math.max(...sizes), Math.min(...sizes))
  const requestSizes = packets.slice(0, 12).map(packet => Buffer.byteLength(JSON.stringify(packet)))
  assert.ok(Math.max(...requestSizes) - Math.min(...requestSizes) < 1024, 'only bounded empty snapshot metadata may differ; entire request must not grow with the candidate pool')
  assert.ok(Buffer.byteLength(text(packets.at(-1))) < 1000)
  assert.equal(readSessionStablePrefix(session).text, '新版人物卡')
  assert.ok(sessionEvents(session).filter(e => e.type === 'user/message' && e.data.content?.some(b => b.text?.includes('【最近剧情与本次任务】'))).length >= 13, 'raw audit history is preserved')
  if (assistant) assert.ok(backgroundSuppressedTurns(sessionEvents(session)).includes(1))
})
