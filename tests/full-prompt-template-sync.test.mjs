import test from 'node:test'
import assert from 'node:assert/strict'
import { createFullPromptTemplateSync } from '../tavern-plugin/lib/domain/full-prompt-template-sync.js'
import { applyTemplateSync } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js'

test('1800 条长历史只传变化楼层，删除和环境变化与全量结果一致', () => {
  const sync=createFullPromptTemplateSync()
  let state={state:{chatId:'c',sessionId:'s',stateRevision:1,chat_metadata:{variables:{}},chat:Array.from({length:1800},(_,i)=>({mes:i+':'+ '历史'.repeat(1000),variables:[{hp:7}]}))},environment:{worldbooks:{large:'设定'.repeat(10000)},extension_settings:{enabled:true},name1:'玩家'}}
  let received=sync(state)
  const fullBytes=JSON.stringify(received).length
  state=structuredClone(state)
  state.state.chat.push({mes:'新消息',variables:[{hp:6}]});state.state.stateRevision++
  let delta=sync(state,received.cursor)
  assert.equal(delta.delta.chat.set.length,1)
  assert.ok(JSON.stringify(delta).length < fullBytes/100)
  received=applyTemplateSync(received,delta)
  assert.deepEqual(received.state,state.state)
  state.state.chat[5].mes='编辑历史';state.state.chat.length=100
  delete state.environment.name1
  state.environment.extension_settings.enabled=false
  delta=sync(state,received.cursor);received=applyTemplateSync(received,delta)
  assert.deepEqual(received.state,state.state)
  assert.deepEqual(received.environment,state.environment)
  assert.equal(delta.delta.chat.set.length,1)
  assert.throws(()=>applyTemplateSync({...received,cursor:'wrong'},delta),/cursor mismatch/)
  const reset=sync({...state,state:{...state.state,chatId:'other'}},received.cursor)
  assert.ok(reset.state)
})
