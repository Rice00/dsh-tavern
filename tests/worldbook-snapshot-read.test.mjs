import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

for (const kind of ['standalone', 'embedded', 'multiple', 'opening']) test('模板快照内共享资源解析且下次读取保持新鲜：' + kind, async () => {
  let cardReads = 0, bookReads = 0
  const book = name => ({ name, entries: { 0: { uid: 0, comment: name, key: [], content: '原内容', constant: true } } })
  const documents = { a: book('A'), b: book('B') }
  const card = { name: '角色', character_book: documents.a }
  const chat = { id: 'chat', sessionId: 's', cardPath: 'card', mode: 'story', _storageRevision: 1, messages: [] }
  if (kind === 'opening') chat.openingWorldbookSnapshot = { version: 1, source: { kind: 'standalone', path: 'a' }, document: documents.a }
  let binding = kind === 'multiple' ? { kind, sources: ['a','b'].map(path => ({ kind: 'standalone', path, available: true })) }
    : kind === 'embedded' ? { kind, cardPath: 'card', available: true } : { kind: 'standalone', path: 'a', available: true }
  const readCard = async () => { cardReads++; return structuredClone(card) }
  const worldBooks = createWorldBookLibrary({ normalizePath: value => value, removeStandalone() {}, cards: { read: readCard }, resources: {
    bindingForCard: async () => binding,
    readText: async path => { bookReads++; return JSON.stringify(documents[path]) }
  } })
  const adapter = createTavernScriptHostAdapter({ resolveChat: async () => structuredClone(chat), writeChat() {}, readCard,
    worldBooks, scriptDispatch: {} })
  const first = await adapter.readFullPromptTemplateState('s')
  assert.equal(cardReads, 1)
  assert.equal(bookReads, kind === 'multiple' ? 2 : kind === 'standalone' ? 1 : 0)
  assert.match(JSON.stringify(first.environment.worldbooks), /原内容/)
  documents.a.entries[0].content = '外部更新'
  cardReads = 0; bookReads = 0
  const next = await adapter.readFullPromptTemplateState('s', first.cursor)
  assert.equal(cardReads, 1)
  assert.equal(bookReads, kind === 'multiple' ? 2 : kind === 'standalone' ? 1 : 0)
  assert.match(JSON.stringify(next.delta.environment.set.worldbooks), /外部更新/)
  // Caller edits must not poison a future snapshot.
  const values = Object.values(next.delta.environment.set.worldbooks)
  Object.values(values[0].entries)[0].content = '污染'
  const fresh = await adapter.readFullPromptTemplateState('s')
  assert.doesNotMatch(JSON.stringify(fresh.environment.worldbooks), /污染/)
  if (kind === 'standalone') {
    binding = { kind: 'standalone', path: 'b', available: true }
    const rebound = await adapter.readFullPromptTemplateState('s', fresh.cursor)
    assert.deepEqual(Object.keys(rebound.delta.environment.set.worldbooks), ['B'])
  }
})
