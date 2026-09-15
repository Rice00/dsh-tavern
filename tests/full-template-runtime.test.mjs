import test from 'node:test'
import assert from 'node:assert/strict'
import { createFullTemplateRuntime } from '../tavern-plugin/lib/domain/full-template-runtime.js'

test('前后台模板任务按会话串行，返回浏览器结果并支持释放后重连', async () => {
  const runtime = createFullTemplateRuntime({ publishSignal(sessionId) {
    const work = runtime.dispatch.claim(sessionId, 'page', true)
    if (!work.event) return
    runtime.dispatch.start(sessionId, work.event.id, work.leaseToken, 'page')
    setTimeout(() => runtime.dispatch.complete(sessionId, work.event.id, [{ ok: true, text: work.event.args[0].template }], 'page', work.leaseToken), 5)
  } })
  const engine = runtime.forSession('session')
  runtime.dispatch.touch('session', 'page', true)
  assert.deepEqual((await Promise.all([engine.render('front'), engine.render('back')])).map(x => x.text), ['front', 'back'])
  assert.equal(runtime.dispatch.dispose('session', 'other-page'), false)
  assert.equal(runtime.dispatch.dispose('session', 'page'), true)
  assert.equal(runtime.dispatch.touch('session', 'new-page', true), true)
  runtime.dispose()
  assert.equal(runtime.dispatch.status('session').present, false)
})
