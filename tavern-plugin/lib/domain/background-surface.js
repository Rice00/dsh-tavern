import { replaceSessionSurface } from './session-surface-mutations.js'
import { restoredSurfaceSeqs } from './surface-restoration.js'
import { sessionEvents, surfaceReplacementRange } from './session-events.js'
import { randomUUID } from 'node:crypto'

export function rewindBackgroundSurface(session, boundary) {
  if (!Number.isSafeInteger(boundary)) return 0
  const events = sessionEvents(session)
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const reset = boundary === -1
  const groups = []
  for (const seq of nodes) {
    const event = bySeq.get(seq)
    const id = event?.data?.message?.id || event?.data?.id || ''
    const keep = reset
      ? event?.type === 'system/message' || String(id).startsWith('tavern-session-prefix:')
      : seq <= boundary
    if (keep) { if (groups.at(-1)?.length) groups.push([]); continue }
    if (!groups.length) groups.push([])
    groups.at(-1).push(seq)
  }
  let removed = 0
  for (const targets of groups.filter(group => group.length).reverse()) {
    // A task may conclude through a tool without any assistant text. Use an
    // empty plugin snapshot, not a fabricated model reply requiring step/start.
    replaceSessionSurface(session, 'user/message', {
      id: 'tavern-background-reset:' + randomUUID(), role: 'user', content: [],
      source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot' }
    }, { start: targets[0], end: targets.at(-1), sourceEventSeqs: targets })
    removed += targets.length
  }
  return removed
}

// Rebuild display suppression from durable empty surface replacements, including
// rollbacks performed before the UI projection existed. Keep raw events intact.
export function backgroundSuppressedTurns(events) {
  const ranges = []
  const restored = restoredSurfaceSeqs(events)
  for (const event of events) {
    if (restored.has(event.seq)) continue
    const op = event.surfaceOp
    const emptyReset = event.type === 'user/message' && event.data?.id?.startsWith('tavern-background-reset:') && event.data.content?.length === 0
    if ((!emptyReset && (event.type !== 'assistant/message' || event.data?.message?.content?.length !== 0)) || op?.op !== 'replace') continue
    const range = surfaceReplacementRange(op)
    if (Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start <= range.end) ranges.push(range)
  }
  ranges.sort((a,b) => a.start-b.start)
  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length-1]
    if (last && range.start <= last.end) last.end = Math.max(last.end,range.end)
    else merged.push({...range})
  }
  const turns = new Set()
  if (!merged.length) return []
  for (const event of events) {
    const seq = event.seq, turn = event.data?.turn
    if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(turn) || turn <= 0) continue
    // Binary search also supports imported histories whose seqs are not sorted.
    let low=0, high=merged.length-1
    while (low<=high) {
      const mid=(low+high)>>>1, range=merged[mid]
      if (seq<range.start) high=mid-1
      else if (seq>range.end) low=mid+1
      else { turns.add(turn); break }
    }
  }
  return [...turns].sort((a,b)=>a-b)
}

/** Read-only display projection. Never acquires or disposes an Agent. */
export function createBackgroundSuppressionReader(readEvidence, {capacity=64}={}) {
  const cache = new Map()
  return function read(sessionId) {
    if (!String(sessionId).startsWith('background-')) return {turns:[]}
    const evidence = readEvidence(sessionId)
    const previous = cache.get(sessionId)
    if (!evidence.loaded) return {turns:[...(previous?.turns || [])], loaded:false}
    const events = evidence.events
    const last = events[events.length-1]
    // Session events are append-only; a new loaded Session invalidates the entry.
    const stamp = events.length + ':' + String(last?.seq)
    if (previous?.session?.deref() === evidence.session && previous.stamp === stamp) return {turns:[...previous.turns], loaded:true}
    const turns = backgroundSuppressedTurns(events)
    cache.delete(sessionId)
    cache.set(sessionId,{session:evidence.session ? new WeakRef(evidence.session) : undefined,stamp,turns})
    while(cache.size>capacity)cache.delete(cache.keys().next().value)
    return {turns:[...turns], loaded:true}
  }
}
