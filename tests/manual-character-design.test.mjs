import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualCharacterDesign } from '../tavern-plugin/lib/domain/manual-character-design.js'

const fields = ['identity', 'narrativeRole', 'coreMotivation', 'innerConflict', 'personality', 'appearance', 'behaviorStyle', 'speechStyle', 'relationships', 'defaultPresentation', 'plotPotential']
const design = { name: '张三', ...Object.fromEntries(fields.map(key => [key, '完整设计内容'])) }
function fixture(runAgent) {
  let chat = { id: 'chat', sessionId: 'session', messages: [{ role: 'assistant', text: '正文保持原样', variables: [{ hp: 10 }] }] }
  const api = createManualCharacterDesign({
    store: { chatForSession: async () => structuredClone(chat), readCard: async () => ({ name: '人物卡' }),
      updateChat: async (_id, update) => { chat = update(structuredClone(chat)); return chat } },
    runAgent, selection: () => ({ provider: 'fixture', model: 'fixture' })
  })
  return { api, get: () => structuredClone(chat) }
}
test('手动设计执行一次，成功后保存档案且不改正文变量', async () => {
  let calls = 0
  const run = fixture(async input => {
    calls++
    assert.equal(input.task, 'character-design')
    assert.equal(input.backgroundTasks.characterDesign, true)
    assert.match(input.system, /skill 加载 character-design/)
    assert.match(input.messages[0].content[0].text, /设计张三/)
    assert.equal(JSON.parse(await input.onToolCall({ name: 'character_design_save', arguments: design })).ok, true)
    assert.equal(run.get().characterDesignDocument, undefined, '完成前不写入正式档案')
  })
  const before = run.get().messages
  await run.api.start({ sessionId: 'session', guidance: '设计张三' })
  await run.api.wait('chat')
  assert.equal(calls, 1)
  assert.equal(run.get().characterDesignTask.status, 'done')
  assert.equal(run.get().characterDesignDocument.characters[0].name, '张三')
  assert.deepEqual(run.get().messages, before)
})
test('模型保存草稿后失败不提交，要求保留且可重试', async () => {
  let fail = true
  const run = fixture(async input => {
    await input.onToolCall({ name: 'character_design_save', arguments: design })
    if (fail) throw new Error('模型连接失败')
  })
  await run.api.start({ sessionId: 'session', guidance: '设计张三' }); await run.api.wait('chat')
  assert.equal(run.get().characterDesignDocument, undefined)
  assert.equal(run.api.project(run.get()).status, 'failed')
  assert.equal(run.get().characterDesignTask.guidance, '设计张三')
  fail = false
  await run.api.start({ sessionId: 'session', guidance: '设计张三' }); await run.api.wait('chat')
  assert.equal(run.get().characterDesignTask.status, 'done')
})
test('重复触发被拒绝，未保存档案时报错，服务重启后不会一直显示运行中', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const run = fixture(() => gate)
  await run.api.start({ sessionId: 'session', guidance: '设计张三' })
  await assert.rejects(run.api.start({ sessionId: 'session', guidance: '设计张三' }), /正在进行/)
  release(); await run.api.wait('chat')
  assert.match(run.get().characterDesignTask.error, /未保存/)
  assert.equal(run.api.project({ id: 'old', characterDesignTask: { status: 'running' } }).status, 'failed')
})
