import { createTavernScriptDispatch } from './tavern-script-dispatch.js'

/** Transport only. All template semantics are executed by the upstream browser plugin. */
export function createFullTemplateRuntime({ publishSignal }) {
  const dispatch = createTavernScriptDispatch({ publishSignal, presenceTtlMs: 60000 })
  const tails = new Map()
  const sessions = new Set()
  async function invoke(sessionId, operation, input) {
    if (!sessionId) throw new Error('完整提示词模板缺少所属会话')
    const previous = tails.get(sessionId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      if (!dispatch.status(sessionId).ready) await new Promise((resolve, reject) => {
        const stop = dispatch.subscribeReady(id => { if (id === sessionId) { clearTimeout(timer); stop(); resolve() } })
        const timer = setTimeout(() => { stop(); const error = new Error('完整提示词模板未在线，请打开酒馆页面后重试'); error.code = 'FULL_TEMPLATE_UNAVAILABLE'; reject(error) }, 60000)
      })
      const result = await dispatch.dispatch(sessionId, operation, [input])
      if (!result.handled) { const error = new Error(result.error || '完整提示词模板尚未就绪，请保持酒馆页面在线'); error.code = 'FULL_TEMPLATE_UNAVAILABLE'; throw error }
      return result.args[0]
    })
    tails.set(sessionId, pending)
    try { return await pending } finally { if (tails.get(sessionId) === pending) tails.delete(sessionId) }
  }
  function forSession(sessionId) {
    sessions.add(sessionId)
    return {
      render: (template, context = {}) => invoke(sessionId, 'render', { template, context: JSON.parse(JSON.stringify(context)) }),
      renderMessages: (messages, context = {}) => invoke(sessionId, 'messages', { messages, context }),
      projectRequest: request => invoke(sessionId, 'request', { request }),
      initializeVariables: (entries, context = {}) => invoke(sessionId, 'initialize', { entries, context })
    }
  }
  return { dispatch, forSession, dispose: () => { for (const id of sessions) dispatch.dispose(id); sessions.clear() } }
}
