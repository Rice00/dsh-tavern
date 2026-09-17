import test from 'node:test'
import assert from 'node:assert/strict'
import { createJsonProjectionCache } from '../tavern-plugin/lib/domain/immutable-json-projection.js'

test('内容相同复用，容量按 LRU 淘汰，失败不返回旧投影', () => {
  const cache = createJsonProjectionCache({ capacity: 2 })
  let projections = 0
  const read = (key, text) => cache(key, text, source => { projections++; return JSON.parse(source) })
  const a = read('a', '{"n":1}')
  read('b', '{}')
  assert.equal(read('a', '{"n":1}'), a)
  read('c', '{}')
  assert.equal(read('a', '{"n":1}'), a)
  read('b', '{}')
  assert.equal(projections, 4)
  assert.throws(() => read('a', 'broken'), SyntaxError)
  assert.notEqual(read('a', '{"n":1}'), a)
  assert.equal(read('a', '{"n":2}').n, 2)
})

test('超过缓存字节预算仍可读取，但不保留超大内容', () => {
  const cache = createJsonProjectionCache({ maxBytes: 20 })
  const small = cache('small', '{}', JSON.parse)
  const text = JSON.stringify({ content: 'x'.repeat(1000) })
  const first = cache('large', text, JSON.parse)
  assert.notEqual(cache('large', text, JSON.parse), first)
  assert.equal(cache('small', '{}', JSON.parse), small)
})
