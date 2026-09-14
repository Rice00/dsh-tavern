import assert from 'node:assert/strict'
import test from 'node:test'
import { adoptConversationBackground, patchConversationBackground } from '../tavern-plugin/lib/domain/conversation-background.js'
import { resolveChatBackgroundModel } from '../tavern-plugin/lib/domain/background-model-selection.js'

test('旧存档一次性保存原生效配置，两个对话修改互不影响', () => {
  const legacy = { backgroundModel: { provider: 'p', model: 'global' }, backgroundModelRevision: 2, backgroundTasks: { variables: false, posture: true, characterDesign: true } }
  const a = adoptConversationBackground({ id: 'a', backgroundModelSelection: { provider: 'p', model: 'old' } }, legacy)
  const b = adoptConversationBackground({ id: 'b' }, legacy)
  assert.equal(a.backgroundModelSelection.model, 'global')
  assert.equal(a.backgroundTasks.variables, false)
  legacy.backgroundModel.model = 'changed'
  assert.equal(adoptConversationBackground(a, legacy), a)
  const changed = patchConversationBackground(a, { backgroundModel: null, backgroundTasks: { posture: false, ledger: true } })
  assert.equal(changed.backgroundModelSelection, null)
  assert.equal(changed.backgroundTasks.posture, false)
  assert.equal(changed.backgroundTasks.ledger, false)
  assert.equal(b.backgroundTasks.posture, true)
  assert.equal(b.backgroundModelSelection.model, 'global')
  assert.deepEqual(resolveChatBackgroundModel(changed, { provider: 'front', model: 'this-game' }), { provider: 'front', model: 'this-game' })
  assert.equal(changed.backgroundTasks.characterDesign, true)
})
