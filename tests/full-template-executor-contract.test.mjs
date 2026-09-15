import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

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
    console: { log() {}, error() {} }, setTimeout() {},
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
