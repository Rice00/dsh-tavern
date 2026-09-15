import { createHash, randomUUID } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('base64url')
const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, digest(item)]))
function changes(value, before) {
  return { set: Object.fromEntries(Object.entries(value).filter(([key, item]) => before[key] !== digest(item))),
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
    const hashes = chat.map(digest)
    const result = compatible ? { cursor: nextCursor, baseCursor: cursor, delta: {
      state: changes(state, before.state), environment: changes(snapshot.environment, before.environment),
      chat: { length: chat.length, set: chat.flatMap((row, index) => hashes[index] === before.chat[index] ? [] : [[index, row]]) }
    } } : { ...snapshot, cursor: nextCursor }
    if (compatible) readers.delete(cursor)
    readers.set(nextCursor, { chatId: state.chatId, sessionId: state.sessionId,
      chat: hashes, state: fields(state), environment: fields(snapshot.environment) })
    while (readers.size > capacity) readers.delete(readers.keys().next().value)
    return result
  }
}
