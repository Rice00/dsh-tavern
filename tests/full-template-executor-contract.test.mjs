import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
test('旧模板入口缺少 processNext 时报告初始化失败，不无限假重连', async () => {
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
  assert.ok(requests.some(item => item.method === 'claimFullTemplateWork' && item.args.ready === false && /processNext/.test(item.args.initializationError)), 'missing processNext must reach the server as initializationError')
})
