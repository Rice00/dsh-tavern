import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')

test('对话设置保存本局模型与开关，切换模型丢弃旧档位响应', async () => {
  const states = [], effects = [], calls = [], pending = []
  let cursor = 0
  const render = vm.runInNewContext('(' + source.slice(source.indexOf('function TavernConversationBackgroundModel(props)'), source.indexOf('function TavernMoreActions(props)')).trim() + ')', {
    React: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value }] }, useEffect: fn => effects.push(fn), createElement: (type, props, ...children) => ({ type, props, children }) },
    rpc: async (method, args, sessionId) => {
      calls.push({ method, args, sessionId })
      if (method === 'getConversationBackgroundConfig') return { modelCatalog: [], backgroundModel: null, backgroundTasks: { variables: true, posture: true, characterDesign: false } }
      if (method === 'getBackgroundModelReasoning') return new Promise(resolve => pending.push(resolve))
      return args
    }, liveTavernView: { invalidate() {} }, backgroundModelLabel: () => ''
  })
  function tree() {
    cursor = 0; effects.length = 0
    const nodes = []
    const visit = n => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return; nodes.push(n); n.children?.forEach(visit) }
    visit(render({ sessionId: 'game-a' })); return nodes
  }
  tree(); effects[0](); await new Promise(resolve => setImmediate(resolve))
  const select = nodes => nodes.find(n => n.props?.['aria-label'] === '本局后台模型')
  select(tree()).props.onChange({ target: { value: JSON.stringify({ provider: 'p', model: 'old' }) } })
  tree(); const cleanup = effects[1]()
  select(tree()).props.onChange({ target: { value: JSON.stringify({ provider: 'p', model: 'new' }) } })
  cleanup(); tree(); effects[1]()
  pending[1]({ reasoning: { efforts: [{ id: 'new-level', name: 'New' }] } }); await new Promise(resolve => setImmediate(resolve))
  pending[0]({ reasoning: { efforts: [{ id: 'old-level' }] } }); await new Promise(resolve => setImmediate(resolve))
  let nodes = tree()
  const effort = nodes.find(n => n.props?.['aria-label'] === '本局后台推理强度')
  assert.match(JSON.stringify(effort), /new-level/); assert.doesNotMatch(JSON.stringify(effort), /old-level/)
  effort.props.onChange({ target: { value: 'new-level' } })
  nodes = tree(); nodes.find(n => n.props?.['aria-label'] === '变量结算').props.onChange({ target: { checked: false } })
  await tree().find(n => n.type === 'button' && n.children.includes('保存本局配置')).props.onClick()
  const call = calls.at(-1)
  assert.equal(call.method, 'setConversationBackgroundConfig'); assert.equal(call.sessionId, 'game-a')
  assert.equal(call.args.sessionId, 'game-a'); assert.equal(call.args.backgroundTasks.variables, false)
  assert.equal(call.args.backgroundModel.reasoningEffort, 'new-level')
  assert.equal(calls.some(c => c.method === 'updateTavernSettings'), false)
})
