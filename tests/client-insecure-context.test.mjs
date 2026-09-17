import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const executorSource = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')

for (const [name, crypto] of [['HTTP', {}], ['no crypto', undefined], ['HTTPS', { randomUUID: () => 'native-uuid' }]]) {
  test(`template executor initializes and preserves message pairing: ${name}`, async () => {
    const frames = [], listeners = new Map(), calls = []
    const host = {
      crypto, AbortController, setTimeout, clearTimeout,
      document: {
        createElement: () => ({ setAttribute() {}, remove() {}, contentWindow: { postMessage() {} } }),
        body: { appendChild: frame => frames.push(frame) }
      },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: name => listeners.delete(name)
    }
    const scope = vm.createContext({ isPlayMode: () => true })
    vm.runInContext(executorSource, scope)
    const executor = scope.createFullTemplateExecutor({ window: host, rpc: async (...args) => { calls.push(args); return {} } })
    executor.sync('session', { chatId: 'chat' })
    const frame = frames[0]
    const token = JSON.parse(frame.srcdoc.match(/const token=("[^"]+")/)[1])
    assert.ok(token.length > 0)
    if (crypto?.randomUUID) assert.equal(token, 'native-uuid')
    const data = { token, type: 'full-template-rpc', requestId: 1, method: 'getFullTemplateRuntimeInfo' }
    await listeners.get('message')({ source: {}, data })
    await listeners.get('message')({ source: frame.contentWindow, data: { ...data, token: 'wrong' } })
    assert.equal(calls.length, 0)
    await listeners.get('message')({ source: frame.contentWindow, data })
    assert.equal(calls.length, 1)
    executor.sync('session', { chatId: 'chat' })
    assert.equal(frames.length, 1)
    executor.dispose()
    assert.equal(calls.at(-1)[1].runtimeId, token)
  })

  test(`chat import creates a reusable operation identity: ${name}`, async () => {
    const statement = mainSource.match(/attempt = \{ operationId: [^\n]+/)[0]
    const scope = vm.createContext({ window: { crypto }, targetWorkspaceId: 'workspace', props: { conversationHost: { connectWorkspace: async id => `session:${id}` } } })
    const attempt = await vm.runInContext(`(async () => { let attempt; ${statement} return attempt; })()`, scope)
    assert.ok(attempt.operationId.length > 0)
    assert.equal(attempt.sessionId, 'session:workspace')
    if (crypto?.randomUUID) assert.equal(attempt.operationId, 'native-uuid')
    assert.equal(JSON.parse(JSON.stringify(attempt)).operationId, attempt.operationId)
  })
}
