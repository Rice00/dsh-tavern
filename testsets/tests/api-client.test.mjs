import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connectGameplay } from '../lib/api.mjs'

async function fixture(t, startBrowser) {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'tavern-api-client-'))
  t.after(() => rm(runtimeHome, { recursive: true, force: true }))
  await mkdir(path.join(runtimeHome, 'logs'))
  await writeFile(path.join(runtimeHome, 'logs/tavern.pid.json'), JSON.stringify({ port: 3081 }))
  await writeFile(path.join(runtimeHome, 'logs/tavern.log'), '')
  const calls = []
  let sequence = 0
  const api = await connectGameplay({ runtimeHome, startBrowser, fetcher: async (url, options) => {
    if (url === 'http://127.0.0.1:3081/') return new Response('', { headers: { 'set-cookie': 'test-auth=value; HttpOnly' } })
    const method = url.split('.').at(-1), args = JSON.parse(options.body)
    calls.push({ method, args })
    let result = {}
    if (method === 'capabilities') result = { version: 1 }
    if (method === 'create') result = { sessionId: 'session-' + ++sequence, chat: { id: 'chat-' + sequence, mode: args.mode }, requiresBrowser: args.sourceCard === 'script.json' }
    return Response.json({ ok: true, ...result })
  } })
  return { api, calls }
}

test('create waits for the session template runtime before exposing a playable result', async t => {
  let release, entered, closed = 0
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const { api } = await fixture(t, async options => {
    assert.equal(options.sessionId, 'session-1')
    assert.equal(options.chatId, 'chat-1')
    assert.equal(options.cookie, 'test-auth=value')
    entered()
    await gate
    return { close: async () => { closed++ } }
  })
  let completed = false
  const pending = api.create({ action: 'play', sourceCard: 'public.json' }, {}).then(result => { completed = true; return result })
  await started
  assert.equal(completed, false)
  release()
  assert.equal((await pending).templateRuntime, 'ready')
  await api.close()
  await api.close()
  assert.equal(closed, 1)
})

test('browser initialization failure preserves ownership for cancellation without sending input', async t => {
  const { api, calls } = await fixture(t, async () => { throw new Error('initialization failed') })
  const result = await api.create({ action: 'play', sourceCard: 'public.json' }, {})
  assert.match(result.error, /初始化|启动失败/)
  assert.equal(result.sessionId, 'session-1')
  await api.cancel()
  assert.deepEqual(calls.filter(call => call.method === 'cancel').map(call => call.args.sessionId), ['session-1'])
  assert.equal(calls.some(call => call.method === 'send'), false)
  await api.close()
})

test('card editing and unsupported helper scripts do not start a template-only browser', async t => {
  const { api } = await fixture(t, async () => { assert.fail('unexpected template browser') })
  await api.create({ action: 'card' }, {})
  const result = await api.create({ action: 'play', sourceCard: 'script.json' }, {})
  assert.equal(result.requiresBrowser, true)
  await api.close()
})
