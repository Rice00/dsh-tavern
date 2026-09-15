import { createTavernScriptDispatch } from './tavern-script-dispatch.js'

/** Transport only. All template semantics are executed by the upstream browser plugin. */
export function createFullTemplateRuntime({ publishSignal, claimTimeoutMs = 30000, readyTimeoutMs = 60000, executionTimeoutMs = 60000 }) {
  const dispatch = createTavernScriptDispatch({ publishSignal, presenceTtlMs: 60000, claimTimeoutMs, executionTimeoutMs })
  const tails = new Map()
  const sessions = new Set()
  function waitUntilReady(sessionId) {
    return new Promise((resolve, reject) => {
      let stop = () => {}
      const timer = setTimeout(() => {
        stop()
        const error = new Error('完整提示词模板未在线，请打开酒馆页面后重试')
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
    if (!sessionId) throw new Error('完整提示词模板缺少所属会话')
    const previous = tails.get(sessionId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        await waitUntilReady(sessionId)
        const result = await dispatch.dispatch(sessionId, operation, [input])
        if (result.handled) return result.args[0]
        // Only unstarted work can be safely retried: templates may mutate variables.
        if (attempt === 0 && result.unavailable && !result.timedOut && !result.disposed && (!result.phase || result.phase === 'queued')) continue
        const error = new Error(result.error || (result.timedOut
          ? '完整提示词模板执行超时，本轮已停止。请检查页面后手动重试。'
          : '完整提示词模板执行器连接中断，请刷新酒馆页面后重试。'))
        error.code = 'FULL_TEMPLATE_UNAVAILABLE'
        throw error
      }
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
  return { dispatch, forSession, dispose: () => { for (const id of sessions) dispatch.dispose(id); sessions.clear() } }
}
