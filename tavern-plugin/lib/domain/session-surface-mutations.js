import { isDeepStrictEqual } from 'node:util'
import { appendSessionEvent, sessionEvents, sessionEventData, surfaceReplacementRange } from './session-events.js'

/** Commit a replacement against the current surface, never the raw history.
 * Existing callers retain their transaction/flush ownership. Message IDs are
 * retry identities together with source references: the same write is reused,
 * conflicting content for that identity is rejected before touching the surface.
 * Restoring an archived message may legitimately reuse its message ID against
 * a different set of displaced nodes; it is not the same mutation.
 */
export function replaceSessionSurface(session, type, data, { start, end, sourceEventSeqs }) {
  const events = sessionEvents(session)
  const id = type === 'assistant/message' || type === 'tool/result' ? data.message?.id : data.id
  const normalized = sessionEventData(session, type, data)
  if (id) {
    const prior = events.find(event => event?.type === type &&
      (event.data?.message?.id || event.data?.id) === id && event.surfaceOp?.op === 'replace' &&
      isDeepStrictEqual(event.sourceEventSeqs, sourceEventSeqs))
    if (prior) {
      const range = surfaceReplacementRange(prior.surfaceOp)
      if (range.start === start && range.end === end && isDeepStrictEqual(prior.data, normalized)) return prior
      throw new Error('消息修改标识已用于不同内容，请重新读取上下文')
    }
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new Error('消息替换范围无效')
  const nodes = session.surface?.nodes
  if (!Array.isArray(nodes) || !nodes.includes(start) || !nodes.includes(end)) throw new Error('消息替换目标已变化，请重新读取上下文')
  const bySeq = new Map(events.flatMap(event => event ? [[event.seq, event]] : []))
  const targets = nodes.filter(seq => seq >= start && seq <= end)
  if (!Array.isArray(sourceEventSeqs) || targets.some(seq => !sourceEventSeqs.includes(seq)) ||
      sourceEventSeqs.some(seq => !Number.isSafeInteger(seq) || !bySeq.has(seq))) throw new Error('消息替换缺少有效的来源引用')
  return appendSessionEvent(session, type, data, {
    surfaceOp: { op: 'replace', start, end }, sourceEventSeqs
  })
}

// Accounting and mutation validation live together; the meter only adapts transport.
export function isTavernSurfaceEdit(session, event) {
  if (event?.type !== 'assistant/message') return false
  const message = event.data?.message
  const source = message?.source
  if (source?.kind !== 'model') return false
  if (source.provider === 'dsh-tavern' && source.model === 'synthetic-trajectory' &&
      message.id?.startsWith('tavern-seed-trajectory:')) return true
  const owned = source.provider === 'dsh-tavern' && source.model === 'reply-projection'
  // The header records creation defaults; selection is persisted as an event.
  const selected = sessionEvents(session).findLast(item => item.type === 'agent-preset/selected' && item.seq < event.seq)
  const preset = selected?.data?.agentPreset ?? session.header?.agentPreset
  if (!owned && !['tavern', 'tavern-background'].includes(preset)) return false
  const replacement = event.surfaceOp
  const refs = event.sourceEventSeqs
  if (replacement?.op !== 'replace' || !Array.isArray(refs) || refs.length === 0) return false
  // Tavern cites replaced surface messages, not provider streaming chunks.
  // Keep genuine malformed provider replies subject to the native validation.
  const range = surfaceReplacementRange(replacement)
  // Undo restores exact old event data, including provider usage, while citing
  // both the displaced node and the archived original outside that range.
  // Treat only a verified copy as restoration, never arbitrary provider output.
  const {tavernRestoredSurfaceSeqs: _marker, ...restoredData} = event.data
  const restored = refs.some(seq => {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq >= event.seq || (seq >= range.start && seq <= range.end)) return false
    const original = session.eventAt(seq)
    if (original?.type !== 'assistant/message') return false
    const {tavernRestoredSurfaceSeqs: _oldMarker, ...originalData} = original.data
    return isDeepStrictEqual(restoredData, originalData)
  })
  if (restored && refs.some(seq => seq >= range.start && seq <= range.end) && refs.every(seq =>
    Number.isSafeInteger(seq) && seq >= 0 && seq < event.seq &&
    ['user/message', 'assistant/message', 'tool/result', 'system/message'].includes(session.eventAt(seq)?.type))) return true
  if (event.data.usage !== undefined) return false
  return refs.every(seq => Number.isSafeInteger(seq) && seq >= range.start && seq <= range.end && seq < event.seq &&
    ['user/message', 'assistant/message', 'tool/result'].includes(session.eventAt(seq)?.type))
}

