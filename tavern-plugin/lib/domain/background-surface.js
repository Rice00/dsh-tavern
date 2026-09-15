import { sessionEvents, appendSessionEvent, surfaceReplacementRange } from './session-events.js'
import { randomUUID } from 'node:crypto'

export function rewindBackgroundSurface(session, boundary) {
  if (!Number.isSafeInteger(boundary)) return 0
  const events = sessionEvents(session)
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  if (boundary === -1) {
    // Preserve the fixed system-context seed while discarding previous task work.
    for (const seq of nodes) {
      const event = events[seq]
      const id = event?.data?.message?.id || event?.data?.id || ''
      if (String(id).startsWith('tavern-session-prefix:')) boundary = Math.max(boundary, seq)
    }
  }
  const shadowed = nodes.filter(function (seq) { return Number.isSafeInteger(seq) && seq > boundary })
  if (shadowed.length === 0) return 0
  let source = null
  let turn = 0
  let step = 1
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = events[nodes[index]]
    const candidate = event && event.data && event.data.message && event.data.message.source
    if (event && event.type === 'assistant/message' && candidate && candidate.kind === 'model') {
      source = candidate
      turn = Math.max(0, Number(event.data.turn) || 0)
      step = Math.max(1, Number(event.data.step) || 1)
      break
    }
  }
  if (source === null) throw new Error('后台 Agent checkpoint 之后存在消息，但找不到可用的模型来源')
  appendSessionEvent(session, 'assistant/message', {
    turn,
    step,
    message: { id: randomUUID(), role: 'assistant', content: [], source }
  }, {
    surfaceOp: { op: 'replace', start: shadowed[0], end: shadowed[shadowed.length - 1] },
    sourceEventSeqs: shadowed
  })
  return shadowed.length
}

// Rebuild display suppression from durable empty surface replacements, including
// rollbacks performed before the UI projection existed. Keep raw events intact.
export function backgroundSuppressedTurns(events) {
  const ranges = []
  for (const event of events) {
    const op = event.surfaceOp
    if (event.type !== 'assistant/message' || op?.op !== 'replace' || event.data?.message?.content?.length !== 0) continue
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
