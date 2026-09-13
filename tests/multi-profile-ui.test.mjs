import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function UserPreferenceProfileTab('), source.indexOf('function createUserPreferenceProfileFeatureModule('))
function render(hasConfirmed, consent = true) {
  const calls = [], warnings = []
  const record = { profileId: 'b', name: '冒险', hasConfirmed, confirmed: hasConfirmed ? { injectionText: '快节奏' } : null,
    profiles: [{ id: 'a', name: '日常' }, { id: 'b', name: '冒险' }] }
  let index = 0
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment',
    useState: initial => [[record, { enabled: true, profileId: 'a', revision: 3 }][index++] ?? initial, () => {}],
    useRef: value => ({ current: value }), useEffect: () => {} }
  const rpc = async (name, args) => { calls.push({ name, args }); return { userProfile: record } }
  const window = { confirm: text => { warnings.push(text); return consent }, prompt: () => '新画像' }
  const fn = new Function('React', 'rpc', 'window', 'usePersistentError', 'notifyTavernDataChanged', component + ';return UserPreferenceProfileTab;')(React, rpc, window, () => ['', () => {}], () => {})
  const tree = fn({ scope: { sessionId: 'game' } })
  function nodes(value) { return value && typeof value === 'object' ? [value, ...(value.children || []).flat(Infinity).flatMap(nodes)] : [] }
  return { tree, calls, warnings, button: text => nodes(tree).find(node => node.type === 'button' && node.children.includes(text)) }
}
test('profile library stays distinct from the game; applying uses selected ID after cache confirmation', async () => {
  const ui = render(true)
  assert.match(JSON.stringify(ui.tree), /当前游戏：日常/)
  await ui.button('应用到当前游戏').props.onClick()
  assert.match(ui.warnings[0], /缓存失效/)
  assert.deepEqual(ui.calls[0], { name: 'setConversationUserProfileEnabled', args: { sessionId: 'game', enabled: true, profileId: 'b' } })
  const cancelled = render(true, false)
  await cancelled.button('应用到当前游戏').props.onClick()
  assert.equal(cancelled.calls.length, 0)
})
test('an empty selected profile still allows disabling the game profile and creating profiles', async () => {
  const ui = render(false)
  assert.ok(ui.button('新建画像'))
  assert.equal(ui.button('应用到当前游戏'), undefined)
  await ui.button('关闭当前游戏画像').props.onClick()
  assert.equal(ui.calls[0].args.enabled, false)
})
