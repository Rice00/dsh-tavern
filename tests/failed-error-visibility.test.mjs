import assert from 'node:assert/strict'
import test from 'node:test'
import { setFailedErrorVisibility } from '../tavern-plugin/lib/domain/failed-error-visibility.js'

const events = [
  { type: 'turn/end', data: { turn: 8, reason: { kind: 'error' } } },
  { type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } } },
  { type: 'turn/end', data: { turn: 10, reason: { kind: 'aborted' } } }
]
test('旧失败仅保存错误可见性，不改变后续正常剧情或回退字段', () => {
  const chat = { messages: [{ turn: 9, text: '本轮运行失败是玩家提到的话' }], timeline: { revision: 3 }, suppressedDshTurns: [2] }
  const before = structuredClone(chat)
  const saved = setFailedErrorVisibility(chat, events, 8, true)
  assert.deepEqual(chat, before)
  assert.deepEqual(saved, { ...before, hiddenDshErrorTurns: [8] })
  const reloaded = JSON.parse(JSON.stringify(saved))
  assert.deepEqual(setFailedErrorVisibility(reloaded, events, 8, false), { ...before, hiddenDshErrorTurns: [] })
})
test('不允许把正常或停止轮次标为错误，不推断下一轮归属', () => {
  for (const turn of [9, 10, 11, '8', 0, NaN]) assert.throws(() => setFailedErrorVisibility({}, events, turn, true))
  assert.throws(() => setFailedErrorVisibility({}, events, 8, 'true'))
})
test('连续操作保留其他轮次的隐藏选择，重复请求幂等', () => {
  const chat = { hiddenDshErrorTurns: [3] }
  const once = setFailedErrorVisibility(chat, events, 8, true)
  assert.deepEqual(once.hiddenDshErrorTurns, [3, 8])
  assert.deepEqual(setFailedErrorVisibility(once, events, 8, true), once)
  assert.deepEqual(setFailedErrorVisibility(once, events, 8, false).hiddenDshErrorTurns, [3])
})
