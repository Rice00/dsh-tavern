import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createFullTemplateRuntime } from '../../tavern-plugin/lib/domain/full-template-runtime.js'
import { startTemplateBrowser } from '../lib/template-browser.mjs'

test('API-only template work fails; the automated browser completes work and releases ownership', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const runtime = createFullTemplateRuntime({ readyTimeoutMs: 40 })
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.forSession('test-session').render('桂花热茶'), error =>
    error.code === 'FULL_TEMPLATE_UNAVAILABLE' && /执行器未响应/.test(error.message))
  const calls = []
  let failInitialization = false
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.cookie, 'test-auth=authenticated')
      if (req.url === '/template.js') {
        res.setHeader('content-type', 'text/javascript')
        res.end(`export const templateHost={};export const createTemplateServices=()=>({});export const createTemplatePanel=()=>({});
          export async function connectTemplateSession(){${failInitialization ? 'throw new Error("template initialization rejected");' : ''}
          return {context:{},synchronize:async()=>({}),project:async(operation,input)=>({text:input.template}),flush:async()=>{}}}`)
        return
      }
      if (!req.url.startsWith('/api/dsh-tavern/vendor/')) {
        let body = ''; for await (const chunk of req) body += chunk
        const args = JSON.parse(body || '{}'), method = req.url.split('/').at(-1)
        calls.push({ method, sessionId: args.sessionId })
        let result = {}
        if (method === 'getFullTemplateRuntimeInfo') result = { entryUrl: '/template.js' }
        if (method === 'heartbeatFullTemplateRuntime') result = runtime.heartbeat(args.sessionId, args.runtimeId, args.phase, args.initializationError)
        if (method === 'claimFullTemplateWork') result = runtime.dispatch.claim(args.sessionId, args.runtimeId, args.ready, args.initializationError)
        if (method === 'startFullTemplateWork') result = await runtime.start(args.sessionId, args.eventId, args.leaseToken, args.runtimeId)
        if (method === 'completeFullTemplateWork') result = { completed: await runtime.complete(args.sessionId, args.eventId, args.args, args.runtimeId, args.leaseToken, args.error) }
        if (method === 'releaseFullTemplateRuntime') result = { released: runtime.dispatch.dispose(args.sessionId, args.runtimeId) }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, ...result }))
      } else { res.setHeader('content-type', 'text/javascript'); res.end('') }
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const options = { origin: 'http://127.0.0.1:' + server.address().port, cookie: 'test-auth=authenticated', sessionId: 'test-session', chatId: 'test-chat', timeoutMs: 5000 }
  const browser = await startTemplateBrowser(options)
  t.after(() => browser.close())
  assert.equal((await runtime.forSession('test-session').render('桂花热茶')).text, '桂花热茶')
  assert.equal((await runtime.forSession('test-session').render('东边石桥')).text, '东边石桥')
  assert.ok(calls.some(call => call.method === 'completeFullTemplateWork'))
  assert.ok(calls.every(call => call.sessionId === 'test-session'))
  await browser.close()
  assert.equal(runtime.dispatch.status('test-session').present, false)
  failInitialization = true
  await assert.rejects(startTemplateBrowser(options), /template initialization rejected/)
  assert.equal(runtime.dispatch.status('test-session').present, false)
})
