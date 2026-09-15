import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemplateSessionTasks } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/session-tasks.js'
import { createNativeTemplateConnection } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js'
import { createFullTemplateRuntime } from '../tavern-plugin/lib/domain/full-template-runtime.js'
const deferred = () => { let resolve, reject;const promise = new Promise((a,b) => {resolve=a;reject=b});return {promise,resolve,reject} }

async function harness({saveGate, syncGate, receiptFailure=false}={}) {
  const trace=[]
  let state={stateRevision:1,chat:[{mes:'opening',variables:[{hp:7}]}],chat_metadata:{variables:{}}}
  const connection=await createNativeTemplateConnection({sessionId:'s',services:{onPersistenceError(){}},rpc:async(method,args)=>{
    trace.push(method)
    if(method==='getFullPromptTemplateState') return {state:structuredClone(state),environment:{dsh:{model:'old'},extension_settings:{EjsTemplate:{},variables:{global:{}}}}}
    if(method==='saveFullPromptTemplateState') {
      if(saveGate) await saveGate.promise
      state={...structuredClone(args.state),stateRevision:state.stateRevision+1}
      return {updated:true,state:structuredClone(state)}
    }
    throw Error(method)
  }})
  const runtime=createFullTemplateRuntime({publishSignal(){}})
  runtime.dispatch.touch('s','browser',true)
  const plugin={
    refresh:async()=>trace.push('refresh'),
    project:async(name,input)=>{
      trace.push('project:'+name)
      if(name==='fail')throw Error('upstream error')
      if(input?.template==='save') {connection.snapshot.chat[0].variables[0].hp++;void connection.callbacks.saveChatConditional(connection.snapshot).catch(()=>{})}
      return {text:name,model:connection.snapshot.dsh.model}
    },
    synchronize:async()=>{trace.push('sync');if(syncGate)await syncGate.promise;return {synchronized:true}},
    dispose:async()=>trace.push('dispose')
  }
  const tasks=createTemplateSessionTasks({connection,plugin,dispatch:{
    claim:async()=>{trace.push('claim');return runtime.dispatch.claim('s','browser',true)},
    start:async w=>{trace.push('start');return runtime.dispatch.start('s',w.event.id,w.leaseToken,'browser')},
    complete:async(w,r)=>{trace.push('complete');if(receiptFailure)throw Error('receipt disconnected');return runtime.dispatch.complete('s',w.event.id,r.args,'browser',w.leaseToken,r.error)}
  }})
  trace.length=0
  return {tasks,runtime,trace,state:()=>state}
}

test('同一 interface 串行协调历史同步与前台请求，每项任务仅刷新一次',async()=>{
  const syncGate=deferred(),h=await harness({syncGate})
  const syncing=h.tasks.synchronize()
  await new Promise(r=>setImmediate(r))
  const output=h.runtime.forSession('s').render('text')
  const draining=h.tasks.processNext()
  await new Promise(r=>setImmediate(r))
  assert.deepEqual(h.trace,['getFullPromptTemplateState','refresh','sync'])
  syncGate.resolve();await syncing;await draining
  assert.equal((await output).text,'render')
  assert.deepEqual(h.trace,['getFullPromptTemplateState','refresh','sync','claim','start','getFullPromptTemplateState','refresh','project:render','complete'])
  await h.tasks.dispose();h.runtime.dispose()
})

test('模板触发异步保存，持久化完成前不能发送成功回执',async()=>{
  const saveGate=deferred(),h=await harness({saveGate})
  const output=h.runtime.forSession('s').render('save')
  await new Promise(r=>setImmediate(r))
  const draining=h.tasks.processNext()
  await new Promise(r=>setImmediate(r))
  assert.ok(h.trace.includes('saveFullPromptTemplateState'))
  assert.equal(h.trace.includes('complete'),false)
  saveGate.resolve();await draining;await output
  assert.equal(h.state().chat[0].variables[0].hp,8)
  assert.equal(h.trace.at(-1),'complete')
  await h.tasks.dispose();h.runtime.dispose()
})

test('保存失败返回失败回执，不重跑有副作用的模板',async()=>{
  const saveGate=deferred(),h=await harness({saveGate})
  const output=h.runtime.forSession('s').render('save')
  const rejected=assert.rejects(output,/disk failed/)
  await new Promise(r=>setImmediate(r))
  const draining=h.tasks.processNext();await new Promise(r=>setImmediate(r))
  saveGate.reject(Error('disk failed'));await draining;await rejected
  assert.equal(h.trace.filter(x=>x==='project:render').length,1)
  await assert.rejects(h.tasks.dispose(),/disk failed/);h.runtime.dispose()
})

test('直接调用也使用同一任务队列，模型上下文在刷新后设置',async()=>{
  const h=await harness()
  const [a,b]=await Promise.all([h.tasks.project('request',{request:{model:'new'}}),h.tasks.project('render',{})])
  assert.equal(a.model,'new');assert.equal(b.model,'old')
  assert.equal(h.trace.filter(x=>x==='getFullPromptTemplateState').length,2)
  await h.tasks.dispose();await assert.rejects(h.tasks.project('render',{}),/disposed/);h.runtime.dispose()
})

test('回执传输失败不再次发送失败回执或执行模板',async()=>{
  const h=await harness({receiptFailure:true})
  const output=h.runtime.forSession('s').render('text');const rejected=assert.rejects(output)
  await new Promise(r=>setImmediate(r))
  await assert.rejects(h.tasks.processNext(),/receipt disconnected/)
  assert.equal(h.trace.filter(x=>x==='complete').length,1)
  assert.equal(h.trace.filter(x=>x.startsWith('project:')).length,1)
  h.runtime.dispose();await rejected;await h.tasks.dispose()
})
