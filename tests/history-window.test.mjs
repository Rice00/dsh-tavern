import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/modules/history-window.js', import.meta.url), 'utf8')
const project = vm.runInNewContext(source + ';tavernHistoryWindow')
function fixture(count, start = 1) {
  const nodes = new Map(), order = [], outline = []
  for (let turn = 1; turn <= count; turn++) {
    outline.push({ turn, seq: turn * 10 })
    if (turn < start) continue
    for (const kind of ['user', 'assistant', 'tail']) {
      const key = `${turn}-${kind}`
      nodes.set(key, { key, kind, anchorSeq: turn * 10, location: { kind: 'turn', turn: { turn } } })
      order.push(key)
    }
  }
  return { snapshot: { nodes, order, navigation: { items: () => outline } }, outline }
}
test('365 turns render only the latest 20; each expansion adds 100 complete turns and collapse restores 20', () => {
  const { snapshot, outline } = fixture(365)
  const original = snapshot.order.slice()
  for (const [limit, first, length] of [[20, 346, 60], [120, 246, 360], [220, 146, 660], [420, 1, 1095], [20, 346, 60]]) {
    const result = project(snapshot, outline, limit)
    assert.equal(result.first, first)
    assert.equal(result.seq, first * 10)
    assert.equal(result.order.length, length)
    assert.equal(result.order[0], `${first}-user`)
    assert.equal(result.order.at(-1), '365-tail')
  }
  assert.deepEqual(snapshot.order, original)
  assert.equal(snapshot.nodes.size, 1095)
})
test('event-paged history requests the missing start of the 20-turn window', () => {
  const { snapshot, outline } = fixture(365, 350)
  const result = project(snapshot, outline, 20)
  assert.equal(result.seq, 3460)
  assert.equal(result.order.length, 16 * 3)
})
test('new turns slide the default window; short histories retain unowned initial content', () => {
  assert.equal(project(...Object.values(fixture(366)), 20).first, 347)
  const { snapshot, outline } = fixture(3)
  snapshot.nodes.set('intro', { anchorSeq: 0 })
  snapshot.order.unshift('intro')
  assert.equal(project(snapshot, outline, 20).order[0], 'intro')
})
test('view adapter keeps native injections, child slots, and node store; only projected order is bounded', () => {
  const { snapshot, outline } = fixture(365)
  let registered
  function Native() {}
  const entry = { options: { id: 'chat' }, component: Native, inject: () => ({}), children: { nodes: {} }, store: {}, locale: 'chat' }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), useState: x => [x, () => {}], useRef: x => ({ current: x }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {} }
  const register = vm.runInNewContext(source + ';registerTavernHistoryWindow', { React, useLiveTavernView: () => ({ view: { mode: 'story' } }), isPlayMode: () => true })
  register({ effect: fn => fn(), slots: { subscribe: () => () => {}, inject: (_name, fn) => fn(), entriesOfSlot: () => [entry], register: (options, component) => { registered = { options, component } } } })
  assert.equal(registered.options.inject, entry.inject)
  assert.equal(registered.options.children, entry.children)
  const props = { sessionId: 'test', useChat: selector => selector(snapshot), useProjection: () => outline, useSession: selector => selector({ hasMore: true }) }
  const window = registered.component(props)
  const tree = window.type(window.props)
  const native = tree.children.find(node => node.type === Native)
  assert.equal(native.props.useChat(s => s.order).length, 60)
  assert.equal(native.props.useChat(s => s.nodes), snapshot.nodes)
  assert.equal(native.props.useChat(s => s.order), native.props.useChat(s => s.order), 'stable selector snapshots')
  assert.equal(native.props.useSession(s => s.hasMore), false)
})

test('load earlier and return latest actions render 20 → 120 → 220 → 20 without altering native history', async () => {
  const { snapshot, outline } = fixture(365)
  let registered, hook = 0
  const values = [], loads = []
  function Native() {}
  const React = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => { const index = hook++; if (!(index in values)) values[index] = initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }] },
    useRef: x => ({ current: x }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {} }
  const register = vm.runInNewContext(source + ';registerTavernHistoryWindow', { React, useLiveTavernView: () => ({ view: { mode: 'story' } }), isPlayMode: () => true })
  register({ effect: fn => fn(), slots: { subscribe: () => () => {}, inject: (_name, fn) => fn(), entriesOfSlot: () => [{ options: { id: 'chat' }, component: Native }], register: (_options, component) => { registered = component; return () => {} } } })
  const props = { sessionId: 'game', useChat: selector => selector(snapshot), useProjection: () => outline, useSession: selector => selector({ hasMore: false }), loadThrough: async seq => { loads.push(seq) } }
  function render() { hook = 0; const wrapper = registered(props); return wrapper.type(wrapper.props) }
  function count(tree) { return tree.children.find(node => node.type === Native).props.useChat(s => s.order).length / 3 }
  function button(tree, text) { return tree.children[0].children.find(node => node && node.children.includes(text)) }
  let tree = render()
  assert.equal(count(tree), 20)
  await button(tree, '查看更早（100 轮）').props.onClick()
  tree = render(); assert.equal(count(tree), 120)
  await button(tree, '查看更早（100 轮）').props.onClick()
  tree = render(); assert.equal(count(tree), 220)
  button(tree, '回到最新').props.onClick()
  tree = render(); assert.equal(count(tree), 20)
  assert.deepEqual(loads, [2460, 1460])
  assert.equal(snapshot.order.length, 1095)
})

test('installation waits for the native chat registration and releases its subscription', () => {
  let original, notify, installs = 0, removed = 0, unsubscribed = 0
  const register = vm.runInNewContext(source + ';registerTavernHistoryWindow', { React: {} })
  let dispose
  register({ effect: fn => { dispose = fn() }, slots: {
    inject: (_key, fn) => fn(), entriesOfSlot: () => original ? [original] : [],
    subscribe: (_key, listener) => { notify = listener; return () => { unsubscribed++ } },
    register: () => { installs++; return () => { removed++ } }
  } })
  assert.equal(installs, 0)
  original = { options: { id: 'chat' }, component: function Chat() {} }
  notify(); notify()
  assert.equal(installs, 1)
  dispose()
  assert.equal(removed, 1)
  assert.equal(unsubscribed, 1)
})
