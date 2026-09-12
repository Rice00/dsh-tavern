import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settledTurn, loadScenario, assertions } from '../lib/scenario.mjs'
import { nativeResult } from '../lib/evidence.mjs'

test('cannot advance on previous settlement, partial reply or pending MVU', () => {
  const chat = { settleStatus: 'done', messages: [{ role: 'assistant', greeting: true }, { role: 'user', text: '继续' }] }
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.messages.push({ role: 'assistant', text: '正文', mvu: { pending: true } })
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.messages[2].mvu.pending = false
  chat.settleStatus = 'running'
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.settleStatus = 'done'
  assert.equal(settledTurn(chat, 1, '继续').ready, true)
  assert.match(settledTurn(chat, 1, '不同输入').error, /不一致/)
})
test('background failure cannot hide behind a successful foreground response', () => {
  const chat = { settleStatus: 'failed', settleError: 'provider failure', messages: [{ role: 'user', text: '继续' }, { role: 'assistant', text: '正文' }] }
  assert.equal(settledTurn(chat, 0, '继续').error, 'provider failure')
  chat.settleStatus = 'done'
  chat.messages[1].mvu = { receipt: { failures: [{ message: 'invalid patch' }] } }
  assert.match(settledTurn(chat, 0, '继续').error, /失败/)
})
test('native completion follows the new turn, not an old end or intermediate tool step', () => {
  const events = [ { seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 3, type: 'turn/start', data: { turn: 2 } }, { seq: 4, type: 'step/end', data: { turn: 2 } } ]
  assert.equal(nativeResult(events, 2).ready, false)
  events.push({ seq: 5, type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '完成' }] } } }, { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(nativeResult(events, 2).text, '完成')
  assert.equal(nativeResult(events, 6).ready, false)
})
test('scenario validation rejects unsupported assertions and image outside play', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'play-scenario-'))
  const file = path.join(root, 'test.json')
  const base = { model: { provider: 'p', model: 'm' }, steps: [{ action: 'card' }, { action: 'say', input: 'test' }] }
  try {
    await writeFile(file, JSON.stringify(base)); assert.equal((await loadScenario(file)).steps.length, 2)
    base.steps.push({ action: 'image' }); await writeFile(file, JSON.stringify(base)); await assert.rejects(loadScenario(file), /游玩对话/)
    base.steps.pop(); base.steps[1].expect = { typo: true }; await writeFile(file, JSON.stringify(base)); await assert.rejects(loadScenario(file), /不支持的断言/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('state assertions fail on missing data rather than silently passing', () => {
  assert.equal(assertions({ state: [{ path: 'a.b', equals: 1 }] }, { state: {} })[0].passed, false)
})

test('refusal marks keep service errors and fictional dialogue separate', async () => {
  const { classifyResponse, refusalPatterns, requestChecks } = await import('../lib/refusal.mjs')
  assert.equal(classifyResponse({ text: '抱歉，我无法帮助你完成这个请求。' }).refused, true)
  assert.equal(classifyResponse({ text: "I cannot assist with that request." }).verdict, '未通过')
  assert.equal(classifyResponse({ text: '阿芙拉摇头说：“抱歉，我无法帮助你。”' }).refused, false)
  assert.equal(classifyResponse({ text: '她把麦酒推到你面前。' }).verdict, '通过')
  assert.equal(classifyResponse({ error: 'HTTP 429', completed: false }).refused, null)
  assert.equal(classifyResponse({ finish: 'content_filter', completed: false }).refused, true)
  assert.equal(classifyResponse({ text: '拒绝标记' }, refusalPatterns(['^拒绝标记$'])).refused, true)
  assert.throws(() => refusalPatterns(['[']), SyntaxError)
  const checks = requestChecks([{ id: 'a', scope: 'background', task: 'settlement', status: 'completed', response: { text: '抱歉，我不能提供此类信息。' } }, { id: 'b', scope: 'background', task: 'scene-image', status: 'completed', response: {} }], 'story', refusalPatterns())
  assert.equal(checks[0].agent, 'background'); assert.equal(checks[0].refused, true)
  assert.equal(checks[1].agent, 'image'); assert.equal(checks[1].refused, false)
})
