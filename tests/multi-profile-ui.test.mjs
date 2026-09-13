import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function UserPreferenceProfileTab('), source.indexOf('function createUserPreferenceProfileFeatureModule('))
function render(hasConfirmed, consent = true, activeId = 'a') {
  const calls = [], warnings = []
  const record = { profileId: 'b', name: '冒险', hasConfirmed, confirmed: hasConfirmed ? { injectionText: '快节奏' } : null,
    defaultProfileId: 'a', profiles: [{ id: 'a', name: '日常', hasConfirmed: true, confirmedRevision: 4 }, { id: 'b', name: '冒险', hasConfirmed, confirmedRevision: 3 }] }
  let index = 0
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment',
    useState: initial => [[record, { enabled: true, profileId: activeId, revision: 3 }, false, '', false, false, false, true][index++] ?? initial, () => {}],
    useRef: value => ({ current: value }), useEffect: () => {} }
  const rpc = async (name, args) => { calls.push({ name, args }); return { userProfile: record } }
  const window = { confirm: text => { warnings.push(text); return consent }, prompt: () => '新画像' }
  const fn = new Function('React', 'rpc', 'window', 'usePersistentError', 'notifyTavernDataChanged', component + ';return UserPreferenceProfileTab;')(React, rpc, window, () => ['', () => {}], () => {})
  const tree = fn({ scope: { sessionId: 'game' } })
  function nodes(value) { return value && typeof value === 'object' ? [value, ...(value.children || []).flat(Infinity).flatMap(nodes)] : [] }
  return { tree, calls, warnings, nodes: nodes(tree), button: text => nodes(tree).find(node => node.type === 'button' && node.children.includes(text)) }
}
test('game switching confirms cache impact and does not depend on library selection', async () => {
  const ui = render(true)
  assert.ok(ui.button('日常 · 使用中').props.disabled)
  await ui.button('冒险').props.onClick()
  assert.match(ui.warnings[0], /缓存失效/)
  assert.deepEqual(ui.calls[0].args, { sessionId: 'game', enabled: true, profileId: 'b' })
  const cancelled = render(true, false)
  await cancelled.button('冒险').props.onClick()
  assert.equal(cancelled.calls.length, 0)
})
test('unconfirmed library profiles do not hide game controls', async () => {
  const ui = render(false)
  assert.ok(ui.button('新建'))
  assert.equal(ui.button('冒险'), undefined)
  await ui.button('停用').props.onClick()
  assert.equal(ui.calls[0].args.enabled, false)
})
test('library selection and new-game defaults use separate controls without changing the current game', async () => {
  const ui = render(true)
  ui.nodes.find(node => node.props?.['aria-label'] === '查看画像').props.onChange({ target: { value: 'a' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.calls[0].args.action, 'select')
  assert.equal(ui.warnings.length, 0)
  ui.nodes.find(node => node.props?.id === 'tavern-profile-default').props.onChange({ target: { value: '' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.calls[1].args.action, 'default')
  assert.equal(ui.calls[1].args.profileId, '')
})
test('updating a stale game uses its own profile even when browsing another one', async () => {
  const ui = render(true)
  assert.match(JSON.stringify(ui.tree), /这局仍使用修改前的内容/)
  await ui.button('更新到当前游戏').props.onClick()
  assert.equal(ui.calls[0].args.profileId, 'a')
})
