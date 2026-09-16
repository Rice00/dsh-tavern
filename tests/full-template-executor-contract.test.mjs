import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createFullTemplateRuntime } from '../tavern-plugin/lib/domain/full-template-runtime.js'

const source = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
test('模板连 project 都缺失时报告初始化失败，不无限假重连', async () => {
  let frame
  const host = { document: { createElement() { return frame = { setAttribute() {}, contentWindow: {}, remove() {} } }, body: { appendChild() {} } }, crypto: { randomUUID: () => 'runtime' }, addEventListener() {}, removeEventListener() {} }
  const scope = vm.createContext({ isPlayMode: () => true })
  vm.runInContext(source, scope)
  scope.createFullTemplateExecutor({ window: host, rpc: async () => ({}) }).sync('session', { chatId: 'chat' })
  const code = frame.srcdoc.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '').replace('await import(new URL(entryUrl,document.baseURI).href)', 'await loadTemplateModule(entryUrl)')
  const requests = []
  let receive
  const browser = vm.createContext({
    YAML: {}, loadTemplateModule: async () => ({ templateHost: {}, createTemplateServices: () => ({}), createTemplatePanel: () => ({}), connectTemplateSession: async () => ({ context: {}, synchronize() {} }) }),
    console: { log() {}, error() {} }, setTimeout() {}, clearTimeout() {},
    fetch: async () => ({ text: async () => '' }),
    addEventListener(type, fn) { if (type === 'message') receive = fn },
    parent: { postMessage(message) { requests.push(message); queueMicrotask(() => receive({ source: browser.parent, data: { token: 'runtime', requestId: message.requestId, result: {} } })) } }
  })
  browser.window = browser
  vm.runInContext(code, browser)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(requests.some(item => item.method === 'claimFullTemplateWork' && item.args.ready === false && /project/.test(item.args.initializationError)), 'missing project must reach the server as initializationError')
})

test('旧版接口沿用官方 project，保存完成后才提交回执', async () => {
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  const calls = []
  const plugin = { async project(name, input) { calls.push(['project',name,input]); return { text:'rendered' } }, async flush() { calls.push(['flush']) } }
  const rpc = async (method, args) => {
    calls.push([method,args])
    if (method === 'claimFullTemplateWork') return { event:{ id:'event',name:'render',args:['template'] },leaseToken:'lease' }
    if (method === 'startFullTemplateWork') return { started:true }
    return {}
  }
  assert.equal(await scope.createLegacyTemplateWorkProcessor(plugin,rpc,'runtime')(),true)
  assert.deepEqual(calls.map(call=>call[0]),['claimFullTemplateWork','startFullTemplateWork','project','flush','completeFullTemplateWork'])
  assert.equal(calls.at(-1)[1].args[0].text,'rendered')
})

test('回执传输失败不再次提交或重复执行模板', async () => {
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  let projects=0,receipts=0
  const plugin = { async project() { projects++; return {} },async flush() {} }
  const rpc = async method => {
    if(method==='claimFullTemplateWork')return{event:{id:'e',name:'render',args:['x']},leaseToken:'l'}
    if(method==='startFullTemplateWork')return{started:true}
    if(method==='completeFullTemplateWork'){receipts++;throw new Error('network')}
  }
  await assert.rejects(scope.createLegacyTemplateWorkProcessor(plugin,rpc,'runtime')(),/network/)
  assert.equal(projects,1);assert.equal(receipts,1)
})

test('空闲领取逐步退避，任务通知立即唤醒且不会丢失提前到达的通知', async () => {
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  const timers = new Map()
  let id = 0
  const idle = scope.createTemplateIdleWait({
    schedule(fn, delay) { timers.set(++id, {fn, delay}); return id },
    cancel(key) { timers.delete(key) }
  })
  const delays = []
  for (let i = 0; i < 8; i++) {
    const waiting = idle.wait()
    const [key, timer] = [...timers][0]
    delays.push(timer.delay); timers.delete(key); timer.fn(); await waiting
  }
  assert.deepEqual(delays, [100,200,400,800,1600,2000,2000,2000])
  const waiting = idle.wait()
  idle.wake(); await waiting
  assert.equal(timers.size, 0)
  idle.wake(); await idle.wait()
  assert.equal(timers.size, 0)
  const next = idle.wait()
  assert.equal([...timers.values()][0].delay, 100)
  idle.wake(); await next
})

test('执行器忙于同步时，独立心跳仍续报且不会领取或重跑任务', async () => {
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  const sent = [], timers = []
  const heartbeat = scope.createTemplateHeartbeat({ runtimeId: 'page', rpc: async (method, args) => sent.push({method, ...args}),
    schedule: fn => { timers.push(fn); return fn }, cancel: fn => timers.splice(timers.indexOf(fn), 1) })
  await new Promise(r => setImmediate(r))
  heartbeat.phase('synchronizing')
  await timers.shift()()
  assert.deepEqual(sent.map(x => x.phase), ['initializing', 'synchronizing'])
  assert.ok(sent.every(x => x.method === 'heartbeatFullTemplateRuntime'))
  heartbeat.dispose()
  assert.equal(timers.length, 0)
})

test('回执失联后只重发保留的回执，不重新执行模板', async () => {
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  let runs = 0, receipts = 0
  const process = scope.createLegacyTemplateWorkProcessor({ project: async () => { runs++; return 'saved' }, flush: async () => {} }, async method => {
    if (method === 'claimFullTemplateWork') return { event: { id: 'e', name: 'render', args: ['x'] }, leaseToken: 'l' }
    if (method === 'startFullTemplateWork') return { started: true }
    if (++receipts === 1) throw new Error('lost')
    return { completed: true }
  }, 'page')
  await assert.rejects(process(), /lost/)
  await process()
  assert.equal(runs, 1)
  assert.equal(receipts, 2)
})

test('iframe RPC 回包丢失时按期限失败并清除待办，不永久挂起', async () => {
  const line = source.split('\n').find(line => line.startsWith('const rpc='))
  const timers = [], pending = new Map()
  const scope = vm.createContext({ pending, sequence: 0, token: 'page', parent: {postMessage() {}},
    setTimeout(fn, delay) { timers.push({fn, delay}); return timers.length } })
  vm.runInContext(line + ';this.rpc=rpc', scope)
  const call = scope.rpc('getFullPromptTemplateState')
  const rejected = assert.rejects(call, /模板 RPC 超时：getFullPromptTemplateState/)
  assert.equal(timers[0].delay, 15000)
  timers[0].fn()
  await rejected
  assert.equal(pending.size, 0)
})


test('idle template heartbeat stays present for ten minutes and recovers after a suspended page', async t => {
  let now = 100000, nextTick, renewals = 0
  t.mock.method(Date, 'now', () => now)
  const runtime = createFullTemplateRuntime({})
  const scope = vm.createContext({})
  vm.runInContext(source, scope)
  const heartbeat = scope.createTemplateHeartbeat({ runtimeId: 'page',
    rpc: async (_method, args) => { renewals++; return runtime.heartbeat('session', args.runtimeId, args.phase) },
    schedule: fn => { nextTick = fn; return fn }, cancel: () => { nextTick = null } })
  t.after(() => { heartbeat.dispose(); runtime.dispose() })
  heartbeat.phase('ready')
  await new Promise(resolve => setImmediate(resolve))
  for (let index = 0; index < 60; index++) {
    now += 10000
    await nextTick()
    assert.equal(runtime.dispatch.status('session').ready, true)
  }
  assert.equal(renewals, 61)
  now += 97000
  assert.equal(runtime.dispatch.status('session').present, false)
  await nextTick()
  assert.equal(runtime.dispatch.status('session').ready, true)
  assert.equal((await runtime.inspect('session')).task, null, 'heartbeat recovery must not run or replay a template')
})
