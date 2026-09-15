import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectWorldBookTemplates } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { TavernPromptTemplateRuntime } from '../tavern-plugin/lib/domain/tavern-prompt-template-runtime.js'
import { entryRandom, renderWorldbookRandom } from '../tavern-plugin/lib/domain/worldbook-random.js'

const runtime = await TavernPromptTemplateRuntime.create()
test('固定前缀稳定，随机位置完整追加；同轮复用、新轮刷新且不进入冷却', async () => {
  const entries = [
    { ref: 'fixed', constant: true, content: '固定规则', position: 4, depth: 2, order: 5 },
    { ref: 'open', constant: true, content: '<角色库>', position: 4, depth: 2, order: 10 },
    { ref: 'pool', constant: true, content: '<%= Math.random() %> {{roll 1d20}} {{random::甲,乙}}', position: 4, depth: 2, order: 20 },
    { ref: 'close', constant: true, content: '</角色库>', position: 4, depth: 2, order: 30 }
  ].map(e => ({ enabled: true, ...e }))
  const worldBook = { view: { entries } }
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}) })
  const chat = { messages: [{ role: 'assistant', greeting: true, turn: 1, text: '开场' }] }
  const a = await project({ chat, card: {}, userText: '继续' })
  assert.equal(a.error, null)
  assert.equal(a.prefixContext, '固定规则')
  assert.match(a.context, /^<角色库>\n\n0\.\d+ \d+ [甲乙]\n\n<\/角色库>$/)
  assert.deepEqual(a.refs, [])
  chat.worldBookRandomState = a.randomState
  const repeat = await project({ chat, card: {}, userText: '继续' })
  assert.equal(repeat.context, a.context)
  const background = projectWorldBookTemplates({ worldBook, runtime, includeConstants: true, chat, card: {}, randomSeed: 'different-background-seed', randomOutputs: a.randomState.outputs })
  assert.equal(background.foregroundContext, a.context)
  chat.messages.push({ role: 'assistant', turn: 2, text: '正文' })
  const b = await project({ chat, card: {}, userText: '继续' })
  assert.equal(b.prefixContext, a.prefixContext)
  assert.notEqual(b.context, a.context)
})
test('世界书骰子宏支持空格与双冒号，数值在骰面范围内', () => {
  const result = renderWorldbookRandom('{{roll 1d20}} {{roll::2d6+3}} {{random::甲::乙}}', () => 0)
  assert.equal(result, '1 5 甲')
  assert.equal(entryRandom('seed', 'ref')(), entryRandom('seed', 'ref')())
})

test('只迁移实际包裹区间，同位置独立固定段不随绿灯或随机条目移动', async () => {
  const { foregroundWorldbookRefs } = await import('../tavern-plugin/lib/domain/worldbook-placement.js')
  const entries = [
    ['fixed-before', '<规则>固定</规则>', true],
    ['open', '<外层><角色库>', true],
    ['role', '角色资料', false],
    ['close', '</角色库></外层>', true],
    ['fixed-after', '固定尾段', true],
    ['random', '{{roll 1d20}}', true]
  ].map(([ref, content, constant], index) => ({ ref, content, constant, order: index, position: 0, enabled: true }))
  assert.deepEqual([...foregroundWorldbookRefs(entries)].sort(), ['close', 'open', 'random', 'role'])
})
