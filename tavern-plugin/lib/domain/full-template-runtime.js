import { randomUUID, createHash } from 'node:crypto'
import { createTavernScriptDispatch } from './tavern-script-dispatch.js'

/** Transport only. All template semantics are executed by the upstream browser plugin. */
export function createFullTemplateRuntime({ publishSignal, claimTimeoutMs = 30000, readyTimeoutMs = 60000, executionTimeoutMs = 60000, store }) {
  const dispatch = createTavernScriptDispatch({ publishSignal, presenceTtlMs: 60000, claimTimeoutMs, executionTimeoutMs })
  let disposed = false
  const jobs = new Map()
  const journalPath = id => 'template-work/' + createHash('sha256').update(id).digest('hex') + '.json'
  async function saveJob(id, job) {
    if (store) await store.writeJson(journalPath(id), job)
  }
  const health = new Map()
  const tails = new Map()
  const sessions = new Set()
  function waitUntilReady(sessionId) {
    return new Promise((resolve, reject) => {
      let stop = () => {}
      const timer = setTimeout(() => {
        stop()
        const state = dispatch.status(sessionId)
        const status = health.get(sessionId)
        const error = new Error(state.present
          ? '完整提示词模板尚未就绪（' + (status?.phase || '初始化中') + '），请检查模板初始化状态后重试'
          : '完整提示词模板执行器未响应；页面可能已关闭、正在重载或卡顿，请检查酒馆页面后重试')
        error.code = 'FULL_TEMPLATE_UNAVAILABLE'
        reject(error)
      }, readyTimeoutMs)
      function check() {
        const state = dispatch.status(sessionId)
        if (!state.ready && !state.initializationError) return
        clearTimeout(timer); stop()
        if (state.initializationError) {
          const error = new Error(state.initializationError); error.code = 'FULL_TEMPLATE_UNAVAILABLE'; reject(error)
        } else resolve()
      }
      stop = dispatch.subscribeSettled(id => { if (id === sessionId) check() })
      check()
    })
  }
  async function invoke(sessionId, operation, input) {
    if (disposed) throw new Error('完整提示词模板运行时已停止')
    if (!sessionId) throw new Error('完整提示词模板缺少所属会话')
    const previous = tails.get(sessionId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      const prior = store && await store.readJson(journalPath(sessionId))
      // Recovery acknowledges receipts; it never replays template input. Keep
      // the payload in the dispatch closure, not in every journal phase.
      const job = { id: randomUUID(), operation, inputBytes: Buffer.byteLength(JSON.stringify(input)), phase: 'queued', createdAt: Date.now(),
        previous: prior ? { id: prior.id, operation: prior.operation, phase: prior.phase, createdAt: prior.createdAt } : null }
      // Queued work has no side effects and is never replayed after restart.
      // Persist the execution intent before start, and the receipt before ack.
      jobs.set(sessionId, job)
      try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await waitUntilReady(sessionId)
        const result = await dispatch.dispatch(sessionId, operation, [input], null, { eventId: job.id })
        if (result.handled) return result.args[0]
        // Only unstarted work can be safely retried: templates may mutate variables.
        if (!disposed && attempt === 0 && (result.unavailable || result.disposed) && !result.timedOut && (!result.phase || ['queued', 'offered'].includes(result.phase))) continue
        const error = new Error(result.error || (result.timedOut
          ? '完整提示词模板执行超时，本轮已停止。请检查页面后手动重试。'
          : '完整提示词模板执行器连接中断，请刷新酒馆页面后重试。'))
        error.code = 'FULL_TEMPLATE_UNAVAILABLE'
        throw error
      }
      } catch (error) {
        if (job.phase !== 'completed') {
          job.phase = job.phase === 'executing' ? 'interrupted' : 'cancelled'
          job.error = String(error.message || error)
          await saveJob(sessionId, job)
        }
        throw error
      } finally { if (jobs.get(sessionId) === job) jobs.delete(sessionId) }
    })
    tails.set(sessionId, pending)
    try { return await pending } finally { if (tails.get(sessionId) === pending) tails.delete(sessionId) }
  }
  function forSession(sessionId) {
    sessions.add(sessionId)
    return {
      renderInput: (text, context = {}) => invoke(sessionId, 'input', {text, context}),
      prepareWorldbook: (entries, context = {}) => invoke(sessionId, 'worldbook', { entries, context }),
      command: text => invoke(sessionId, 'command', { text }),
      render: (template, context = {}) => invoke(sessionId, 'render', { template, context: JSON.parse(JSON.stringify(context)) }),
      renderMessages: (messages, context = {}) => invoke(sessionId, 'messages', { messages, context }),
      projectRequest: request => invoke(sessionId, 'request', { request }),
      initializeVariables: (entries, context = {}) => invoke(sessionId, 'initialize', { entries, context })
    }
  }
  async function start(sessionId, eventId, leaseToken, runtimeId) {
    const job = jobs.get(sessionId)
    if (!job || job.id !== eventId) return { started: false }
    // Validate the offered lease before persisting execution intent.
    const offered = dispatch.claim(sessionId, runtimeId, true)
    if (offered.event?.id !== eventId || offered.leaseToken !== leaseToken) return { started: false }
    job.phase = 'executing'; job.runtimeId = runtimeId; job.leaseToken = leaseToken
    await saveJob(sessionId, job)
    return dispatch.start(sessionId, eventId, leaseToken, runtimeId)
  }
  async function complete(sessionId, eventId, args, runtimeId, leaseToken, error = '') {
    const job = jobs.get(sessionId) || (store && await store.readJson(journalPath(sessionId)))
    if (!job || job.id !== eventId || job.runtimeId !== runtimeId || job.leaseToken !== leaseToken) return false
    if (job.phase === 'completed') return true
    if (job.phase !== 'executing' || dispatch.status(sessionId).phase !== 'executing' || !dispatch.available(sessionId, runtimeId)) return false
    const completed = { ...job, phase: 'completed', receipt: { args, error }, completedAt: Date.now() }
    await saveJob(sessionId, completed)
    Object.assign(job, completed)
    return dispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error)
  }
  function heartbeat(sessionId, runtimeId, phase, initializationError = '') {
    const ready = ['ready', 'working', 'synchronizing'].includes(phase)
    const active = dispatch.touch(sessionId, runtimeId, ready, initializationError)
    if (active) health.set(sessionId, { phase, seenAt: Date.now() })
    return { active, ...dispatch.status(sessionId) }
  }
  async function inspect(sessionId) {
    const job = jobs.get(sessionId) || (store && await store.readJson(journalPath(sessionId)))
    return { ...dispatch.status(sessionId), heartbeat: health.get(sessionId) || null,
      task: job ? { id: job.id, operation: job.operation, phase: job.phase, createdAt: job.createdAt,
        completedAt: job.completedAt, error: job.error, previous: job.previous } : null }
  }
  return { dispatch, forSession, heartbeat, start, complete, inspect, dispose: () => { disposed = true; for (const id of sessions) dispatch.dispose(id); sessions.clear() } }
}
