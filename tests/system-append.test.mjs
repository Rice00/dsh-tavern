import assert from 'node:assert/strict'
import test from 'node:test'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { applyTavernSettingsPatch, resolveSystemPrompt } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

test('附加指令默认空白，保存、清空和导入均可立即读取', () => {
  assert.equal(prompt('system-append'), '')
  let settings = applyTavernSettingsPatch({}, { systemPrompt: { name: 'system-append', text: '附加内容' } })
  assert.equal(resolveSystemPrompt(settings, 'system-append', prompt), '附加内容')
  settings = applyTavernSettingsPatch(settings, { systemPrompt: { name: 'system-append', text: '' } })
  assert.equal(resolveSystemPrompt(settings, 'system-append', prompt), '')
  assert.doesNotThrow(() => applyTavernSettingsPatch(settings, { systemPrompts: { 'system-append': '' } }))
})

for (const task of ['settlement', 'image', 'phone']) test(task + ' 复用会话时置顶最新指令且清空后移除', async () => {
  let assemble, pending, text = '第一版'
  const seen = []
  const session = { id: task, header: {}, events: [], append(type, data) { this.events.push({ type, data }) } }
  const runner = createBackgroundAgentRunner({
    systemAppend: () => text,
    agents: { get: () => ({ session: { header: {} } }), async create(options) {
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on(event, callback) { if (event === 'system-prompt/assemble') assemble = callback } })
      return { agent: { session, followup() { pending = (async () => {
        const result = await assemble({}, { agent: { session } }, async () => ({ sections: [{ name: 'original', text: '原有指令' }], tools: [] }))
        seen.push(result.sections.map(s => s.text))
        session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
      })() }, async whenIdle() { await pending } }, async dispose() {} }
    } }
  })
  try {
    for (text of ['第一版', '第二版', '']) await runner.run({ sessionId: 'parent', persistent: true, task, selection: { provider: 'test', model: 'fake' }, messages: [], tools: [] })
    assert.deepEqual(seen, [['第一版', '原有指令'], ['第二版', '原有指令'], ['原有指令']])
  } finally { await runner.dispose() }
})
