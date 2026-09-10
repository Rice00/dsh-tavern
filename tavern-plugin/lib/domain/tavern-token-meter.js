import { surfaceReplacementRange } from './session-events.js'
const installations = new WeakMap()

function isTavernSurfaceEdit(session, event) {
  if (event?.type !== 'assistant/message' || event.data?.usage !== undefined) return false
  const message = event.data?.message
  const source = message?.source
  if (source?.kind !== 'model') return false
  if (source.provider === 'dsh-tavern' && source.model === 'synthetic-trajectory' &&
      message.id?.startsWith('tavern-seed-trajectory:')) return true
  if (!['tavern', 'tavern-background'].includes(session.header?.agentPreset)) return false
  const replacement = event.surfaceOp
  const refs = event.sourceEventSeqs
  if (replacement?.op !== 'replace' || !Array.isArray(refs) || refs.length === 0) return false
  // Tavern cites replaced surface messages, not provider streaming chunks.
  // Keep genuine malformed provider replies subject to the native validation.
  const range = surfaceReplacementRange(replacement)
  return refs.every(seq => Number.isSafeInteger(seq) && seq >= range.start && seq <= range.end && seq < event.seq &&
    ['user/message', 'assistant/message', 'tool/result'].includes(session.eventAt(seq).type))
}

/**
 * rc.1's meter assumes every assistant/message belongs to an active model step.
 * Tavern seeds and surface edits have no provider request/usage. Account for them
 * as injected messages in the meter's fold only, preserving their assistant role,
 * surface operation and seq. Never mutate the Session or its outgoing messages.
 * This isolated private-API shim must be covered against the installed host and
 * can be removed when upstream supports out-of-step surface edits natively.
 */
export function installTavernTokenMeter(meter) {
  if (!meter || typeof meter._foldEvent !== 'function') throw new Error('当前 DSH Token Meter 不支持 Tavern 消息统计适配，请检查 DSH 版本')
  let entry = installations.get(meter)
  if (!entry) {
    const original = meter._foldEvent
    const hadOwn = Object.hasOwn(meter, '_foldEvent')
    const compactSignature = original.length === 2
    const originalSync = meter._sync
    const hadOwnSync = Object.hasOwn(meter, '_sync')
    if (compactSignature && typeof originalSync !== 'function') throw new Error('当前 DSH Token Meter 缺少同步入口')
    let activeSession
    function sync(session, ...args) {
      const previous = activeSession
      activeSession = session
      try { return originalSync.call(this, session, ...args) }
      finally { activeSession = previous }
    }
    function fold(...args) {
      const [session, state, event] = compactSignature ? [activeSession, ...args] : args
      const accountingEvent = session && isTavernSurfaceEdit(session, event)
        ? { ...event, type: 'user/message', data: event.data.message }
        : event
      return compactSignature ? original.call(this, state, accountingEvent) : original.call(this, session, state, accountingEvent)
    }
    meter._foldEvent = fold
    if (compactSignature) meter._sync = sync
    entry = { original, fold, hadOwn, originalSync, hadOwnSync, compactSignature, users: 0 }
    installations.set(meter, entry)
  }
  entry.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--entry.users !== 0) return
    if (entry.hadOwn) meter._foldEvent = entry.original
    else delete meter._foldEvent
    if (entry.compactSignature) {
      if (entry.hadOwnSync) meter._sync = entry.originalSync
      else delete meter._sync
    }
    installations.delete(meter)
  }
}
