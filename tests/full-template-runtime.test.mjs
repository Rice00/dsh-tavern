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

test('同步期间首次领取超时，执行器恢复后重派未开始的任务', async () => {
  let offers = 0, executions = 0
  const runtime = createFullTemplateRuntime({ claimTimeoutMs: 100, readyTimeoutMs: 500,
    publishSignal(id) {
      offers++
      if (offers === 1) { setTimeout(() => runtime.dispatch.touch(id, 'page', true), 140); return }
      const work = runtime.dispatch.claim(id, 'page', true)
      assert.equal(runtime.dispatch.start(id, work.event.id, work.leaseToken, 'page').started, true)
      executions++
      runtime.dispatch.complete(id, work.event.id, ['recovered'], 'page', work.leaseToken)
    }
  })
  runtime.dispatch.touch('s', 'page', true)
  assert.equal(await runtime.forSession('s').render('x'), 'recovered')
  assert.equal(offers, 2)
  assert.equal(executions, 1)
  runtime.dispose()
})

test('模板已开始执行后超时不自动重跑', async () => {
  let executions = 0
  const runtime = createFullTemplateRuntime({ executionTimeoutMs: 100, publishSignal(id) {
    const work = runtime.dispatch.claim(id, 'page', true)
    runtime.dispatch.start(id, work.event.id, work.leaseToken, 'page')
    executions++
  } })
  runtime.dispatch.touch('s', 'page', true)
  await assert.rejects(runtime.forSession('s').render('x'), /执行超时/)
  assert.equal(executions, 1)
  runtime.dispose()
})

test('初始化失败立即报告具体原因，不等待在线超时', async () => {
  const runtime = createFullTemplateRuntime({ readyTimeoutMs: 500 })
  runtime.dispatch.touch('s', 'page', false, '模板模块加载失败')
  await assert.rejects(runtime.forSession('s').render('x'), /模板模块加载失败/)
  runtime.dispose()
})
