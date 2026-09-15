import { createHash, randomUUID } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('base64url')
const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, digest(item)]))
function changes(value, before, hashes) {
  return { set: Object.fromEntries(Object.entries(value).filter(([key, item]) => before[key] !== hashes[key])),
    remove: Object.keys(before).filter(key => !Object.hasOwn(value, key)) }
}

/** Transport fingerprints only. The journal remains the authority for writes.
 * A lost/evicted cursor recovers with a full snapshot, never a guessed delta.
 */
export function createFullPromptTemplateSync({ capacity = 32 } = {}) {
  const readers = new Map()
  return function synchronize(snapshot, cursor) {
    const { chat, ...state } = snapshot.state
    const before = readers.get(cursor)
    const compatible = before && before.chatId === state.chatId && before.sessionId === state.sessionId
    const nextCursor = randomUUID()
    // This reader only receives authoritative projections. A storage revision
    // covers messages and metadata; settings/worldbooks have separate lifetimes.
    const unchanged = compatible && Number.isSafeInteger(state.stateRevision) && state.stateRevision > 0 && before.revision === state.stateRevision && before.lifecycle === state.lifecycleRevision
    const hashes = unchanged ? before.chat : chat.map(digest)
    const stateHashes = unchanged ? before.state : fields(state)
    const environmentHashes = fields(snapshot.environment)
    const result = compatible ? { cursor: nextCursor, baseCursor: cursor, delta: {
      state: unchanged ? {set:{},remove:[]} : changes(state, before.state, stateHashes), environment: changes(snapshot.environment, before.environment, environmentHashes),
      chat: { length: chat.length, set: unchanged ? [] : chat.flatMap((row, index) => hashes[index] === before.chat[index] ? [] : [[index, row]]) }
    } } : { ...snapshot, cursor: nextCursor }
    if (compatible) readers.delete(cursor)
    readers.set(nextCursor, { chatId: state.chatId, sessionId: state.sessionId,
      revision:state.stateRevision, lifecycle:state.lifecycleRevision, chat: hashes, state: stateHashes, environment: environmentHashes })
    while (readers.size > capacity) readers.delete(readers.keys().next().value)
    return result
  }
}
