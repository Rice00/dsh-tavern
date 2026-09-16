import test from 'node:test'
import assert from 'node:assert/strict'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { readdir, readFile } from 'node:fs/promises'
function fixture() {
  const events = [{seq: 0, type: 'assistant/message', data: {message: {id: 'old'}}}]
  return {events, surface: {nodes: [0]}, append(type, data, intent) {
    const event = {seq: events.length, type, data, ...intent}; events.push(event)
    this.surface.nodes = [event.seq]; return event
  }}
}
const data = {turn: 1, step: 1, message: {id: 'edit-1', role: 'assistant', content: [{type: 'text', text: '新正文'}]}}
const target = {start: 0, end: 0, sourceEventSeqs: [0]}
test('重复提交复用原事件，冲突及失效目标不产生任何追加', () => {
  const session = fixture()
  const first = replaceSessionSurface(session, 'assistant/message', data, target)
  assert.equal(replaceSessionSurface(session, 'assistant/message', structuredClone(data), target), first)
  assert.equal(session.events.length, 2)
  assert.throws(() => replaceSessionSurface(session, 'assistant/message', {...data, turn: 2}, target), /不同内容/)
  assert.throws(() => replaceSessionSurface(session, 'assistant/message', {...data, message: {...data.message, id: 'other'}}, target), /目标已变化/)
  assert.equal(session.events.length, 2)
})
test('来源必须覆盖被替换节点并指向真实事件', () => {
  const session = fixture()
  for (const refs of [[], [1], [0, 99]]) {
    assert.throws(() => replaceSessionSurface(session, 'assistant/message', data, {...target, sourceEventSeqs: refs}), /来源引用/)
    assert.equal(session.events.length, 1)
  }
})
test('业务模块不再直接拼接 Surface replace 操作', async () => {
  const root = new URL('../tavern-plugin/lib/', import.meta.url)
  const files = ['index.js', ...(await readdir(new URL('domain/', root))).filter(name => name.endsWith('.js') && name !== 'session-surface-mutations.js').map(name => 'domain/' + name)]
  for (const file of files) assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /surfaceOp:\s*\{\s*op:\s*['"]replace['"]/, file)
})
