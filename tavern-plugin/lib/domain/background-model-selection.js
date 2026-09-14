function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBackgroundModel(value) {
  if (value === null || value === undefined) return null
  const input = object(value)
  const provider = text(input.provider)
  const model = text(input.model)
  if (provider === '' || model === '') return null
  const reasoningEffort = text(input.reasoningEffort)
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
}

export function snapshotBackgroundModel(configured) {
  // Null means resolve the current foreground selection when each task starts.
  // Only an explicit user choice is frozen into the game.
  return normalizeBackgroundModel(configured)
}

export function resolveChatBackgroundModel(chat, fallback) {
  const source = object(chat).backgroundModelSelection || fallback
  return normalizeBackgroundModel(source)
}

export async function readBackgroundModelReasoning(llm, selection) {
  const route = normalizeBackgroundModel(selection)
  if (!route) throw new Error('后台模型配置无效')
  // Older hosts can still select models, but cannot advertise reasoning levels.
  if (typeof llm.resolveModelInfo !== 'function') return null
  const info = await llm.resolveModelInfo(route.provider, route.model)
  return info.reasoning || null
}
