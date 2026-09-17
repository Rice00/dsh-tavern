import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Session } from './dsh-session-host.mjs'
import { createRoundHistory } from '../../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { appendSessionEvent, sessionEvents } from '../../tavern-plugin/lib/domain/session-events.js'

const [root, legacy] = process.argv.slice(2)
const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
const session = Session.create('crash-session')
appendSessionEvent(session, 'user/message', { id: 'original-user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'original-assistant', role: 'assistant', content: [{ type: 'text', text: '原正文' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
await persistence.write({ id: 'chat', sessionId: session.id, mode: 'story', messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text: '原正文', variables: [{ hp: 9 }] }], posture: '原状态', settleStatus: 'done' })
const agent = { session, phase: { kind: 'idle', lastTurn: 2 }, followup(message) {
  this.phase.kind = 'running'
  appendSessionEvent(session, 'user/message', { ...message, turn: 3 }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 3, step: 1, message: { id: 'partial-assistant', role: 'assistant', content: [{ type: 'text', text: '未完成的新正文' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}, async whenIdle() {
  if (legacy === 'true') await persistence.update('chat', chat => { delete chat.regenRecovery; return chat }, { source: 'fixture.legacy' })
  await writeFile(join(root, 'session.json'), JSON.stringify({ id: session.id, header: session.header, events: sessionEvents(session) }))
  process.send({ ready: true })
  await new Promise(() => {})
} }
await createRoundHistory({
  chats: { ...persistence, forSession: () => persistence.read('chat'), readCard: async () => ({}) },
  sessions: { get: () => agent }, scripts: {}, timeline: createStoryTimeline(),
  queueSettlement: async () => { throw new Error('must not settle') }, present: async chat => chat
}).regenerate('chat', '', session.id)
