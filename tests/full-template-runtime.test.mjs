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

test('任务与回执落盘，回执丢失后跨进程重建仍可确认，不再执行', async t => {
  const { mkdtemp, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createProfileDataStore } = await import('../tavern-plugin/lib/profile-data-store.js')
  const root = await mkdtemp(join(tmpdir(), 'template-journal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  const runtime = createFullTemplateRuntime({ store, publishSignal() {} })
  runtime.heartbeat('s', 'page', 'ready')
  const output = runtime.forSession('s').render('test')
  let work
  for (let i = 0; i < 100; i++) {
    work = runtime.dispatch.claim('s', 'page', true)
    if (work.event) break
    await new Promise(r => setTimeout(r, 2))
  }
  assert.ok(work.event)
  const file = 'template-work/' + (await readdir(join(root, 'template-work')))[0]
  assert.equal((await store.readJson(file)).phase, 'queued')
  assert.equal((await runtime.start('s', work.event.id, work.leaseToken, 'page')).started, true)
  assert.equal((await store.readJson(file)).phase, 'executing')
  assert.equal(await runtime.complete('s', work.event.id, ['saved'], 'page', work.leaseToken), true)
  assert.equal(await output, 'saved')
  runtime.dispose()
  const restarted = createFullTemplateRuntime({ store, publishSignal() { throw new Error('must not replay') } })
  assert.equal(await restarted.complete('s', work.event.id, ['saved'], 'page', work.leaseToken), true)
  assert.equal(await restarted.complete('s', work.event.id, ['saved'], 'other', work.leaseToken), false)
  restarted.dispose()
})

test('初始化中的执行器报告未就绪，不谎报用户没打开页面', async () => {
  const runtime = createFullTemplateRuntime({ readyTimeoutMs: 5 })
  runtime.heartbeat('s', 'page', 'initializing')
  await assert.rejects(runtime.forSession('s').render('x'), /尚未就绪.*initializing/)
  runtime.dispose()
})

test('刷新页面释放尚未执行的任务后，以同一任务 ID 重新领取', async () => {
  let offers = 0, firstId
  const runtime = createFullTemplateRuntime({ readyTimeoutMs: 100, publishSignal(id) {
    offers++
    const work = runtime.dispatch.claim(id, offers === 1 ? 'old' : 'new', true)
    if (offers === 1) {
      firstId = work.event.id
      runtime.dispatch.dispose(id, 'old')
      runtime.heartbeat(id, 'new', 'ready')
    } else {
      assert.equal(work.event.id, firstId)
      runtime.dispatch.start(id, work.event.id, work.leaseToken, 'new')
      runtime.dispatch.complete(id, work.event.id, ['ok'], 'new', work.leaseToken)
    }
  } })
  runtime.heartbeat('s', 'old', 'ready')
  assert.equal(await runtime.forSession('s').render('x'), 'ok')
  assert.equal(offers, 2)
  runtime.dispose()
})

test('大输入只用于派发，所有持久化阶段仅记录体积且支持重启确认', async () => {
  const records = new Map(), writes = []
  const store = { readJson: async path => records.get(path), writeJson: async (path, value) => {
    const saved = structuredClone(value); records.set(path, saved); writes.push(saved)
  } }
  const runtime = createFullTemplateRuntime({ store, publishSignal() {} })
  runtime.heartbeat('s', 'page', 'ready')
  const template = '秘密模板'.repeat(100000)
  const output = runtime.forSession('s').render(template)
  let work
  for (let i = 0; i < 100; i++) {
    work = runtime.dispatch.claim('s', 'page', true)
    if (work.event) break
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(work.event.args[0].template, template)
  await runtime.start('s', work.event.id, work.leaseToken, 'page')
  await runtime.complete('s', work.event.id, [{ ok: true, text: '结果' }], 'page', work.leaseToken)
  assert.deepEqual(await output, { ok: true, text: '结果' })
  runtime.dispose()
  assert.deepEqual(writes.map(job => job.phase), ['queued', 'executing', 'completed'])
  for (const job of writes) {
    assert.equal(job.input, undefined)
    assert.equal(job.inputBytes, Buffer.byteLength(JSON.stringify({ template, context: {} })))
    assert.ok(Buffer.byteLength(JSON.stringify(job)) < 1024)
  }
  const restarted = createFullTemplateRuntime({ store, publishSignal() { throw new Error('must not replay') } })
  assert.equal(await restarted.complete('s', work.event.id, [], 'page', work.leaseToken), true)
  restarted.dispose()
})
