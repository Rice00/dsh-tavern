import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createFullTemplateRuntime } from '../tavern-plugin/lib/domain/full-template-runtime.js'

// Exercise the real iframe/parent HTTP transport, with only the template body stubbed.
test('expired iframe RPCs release HTTP connections so template presence and work recover', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const { chromium } = await import('playwright')
  let now = Date.now(), stall = false, stalled = 0, active = 0, peak = 0
  t.mock.method(Date, 'now', () => now)
  const runtime = createFullTemplateRuntime({ readyTimeoutMs: 1000 })
  t.after(() => runtime.dispose())
  const source = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body>Recovery test'); return }
    if (path === '/template.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end('export const templateHost={};export const createTemplateServices=()=>({});export const createTemplatePanel=()=>({});export async function connectTemplateSession(){return {context:{},synchronize:async()=>({}),project:async()=>({text:"recovered"}),flush:async()=>{}}}')
      return
    }
    if (!path.startsWith('/rpc/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return }
    const method = path.slice(5)
    let body = ''; for await (const chunk of req) body += chunk
    const args = JSON.parse(body || '{}')
    if (stall && ['heartbeatFullTemplateRuntime', 'claimFullTemplateWork'].includes(method)) {
      stalled++; active++; peak = Math.max(peak, active)
      res.on('close', () => { active-- })
      return // A transport connection that never answers, even after the service recovers.
    }
    let result = {}
    if (method === 'getFullTemplateRuntimeInfo') result = { entryUrl: '/template.js' }
    if (method === 'heartbeatFullTemplateRuntime') result = runtime.heartbeat('session', args.runtimeId, args.phase)
    if (method === 'claimFullTemplateWork') result = runtime.dispatch.claim('session', args.runtimeId, args.ready)
    if (method === 'startFullTemplateWork') result = await runtime.start('session', args.eventId, args.leaseToken, args.runtimeId)
    if (method === 'completeFullTemplateWork') result = { completed: await runtime.complete('session', args.eventId, args.args, args.runtimeId, args.leaseToken, args.error) }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  // Accelerate production timers in both windows; do not replace the RPC implementation.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window)
    window.setTimeout = (fn, ms, ...args) => schedule(fn, ms >= 10000 ? 100 : Math.min(ms, 10), ...args)
  })
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.addScriptTag({ content: 'function isPlayMode(){return true}\n' + source })
  await page.evaluate(() => {
    window.executor = createFullTemplateExecutor({ window, rpc: async (method, args, _sessionId, options) => {
      const response = await fetch('/rpc/' + method, { method: 'POST', body: JSON.stringify(args), signal: options?.signal })
      return response.json()
    } })
    executor.sync('session', { chatId: 'chat', mode: 'story' })
  })
  assert.equal((await runtime.forSession('session').render('first')).text, 'recovered')
  stall = true
  for (let attempt = 0; stalled < 6 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(stalled >= 6, 'fault injection must reach the HTTP transport')
  now += 61000
  assert.equal(runtime.dispatch.status('session').present, false)
  stall = false
  assert.equal((await runtime.forSession('session').render('second')).text, 'recovered')
  assert.ok(peak < 6, 'timed-out RPCs must not exhaust the browser connection pool')
  stall = true
  for (let attempt = 0; active === 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(active > 0, 'dispose must be tested while an HTTP request is still pending')
  await page.evaluate(() => executor.dispose())
  for (let attempt = 0; active > 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(active, 0, 'removing the executor must abort its pending fetches')
})
