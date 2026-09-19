import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('function CandidateQuestion(props)'), source.indexOf('function CandidateGuidePanel(props)'))
function harness(initial = '') {
  let draft = initial, cursor, running = false
  const states = [0, true], refs = [], effects = []
  const panel = { sessionId: 's', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '走近窗边' }, { type: 'scene', text: '雨停了' }] }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useRef: () => refs[0] ||= {}, useState: () => { const i = cursor++; return [states[i], value => { states[i] = value }] }, useEffect: (fn, deps) => effects.push({ fn, deps }) }
  const Component = new Function('React', 'useCandidatePanel', 'useTavernSessionMode', 'latestTavernAssistantMessageId', 'isPlayMode', code + ';return CandidateQuestion')(React, () => panel, () => 'story', () => 'm', () => true)
  const props = { sessionId: 's', useInput: fn => fn({ draft }), useSession: fn => fn({ running }), useChat: () => 'm', inputActions: { setDraft: value => { draft = value } } }
  const render = () => { cursor = 0; effects.length = 0; return Component(props) }
  function buttons(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(buttons); return [...(node.type === 'button' ? [node] : []), ...buttons(node.children)] }
  return { render, buttons, draft: () => draft, panel, states, effects, run: () => { running = true } }
}
test('连续添加人物行为和场景变化保留草稿及完整候选列表', () => {
  const h = harness('手动写的内容')
  const add = () => h.buttons(h.render()).find(node => node.children.includes('追加到输入框')).props.onClick()
  add()
  assert.equal(h.draft(), '手动写的内容\n走近窗边')
  assert.equal(h.states[0], -1)
  assert.equal(h.states[1], true)
  assert.equal(h.buttons(h.render()).filter(node => node.props.className?.includes('question-option')).length, 2)
  h.states[0] = 1; add()
  assert.equal(h.draft(), '手动写的内容\n走近窗边\n【场景变化】雨停了')
})
test('空输入不加前导换行，已有换行不重复；发送中隐藏并收起', () => {
  for (const text of ['', '草稿\n']) {
    const h = harness(text)
    h.buttons(h.render()).find(node => node.children.includes('追加到输入框')).props.onClick()
    assert.equal(h.draft(), text + '走近窗边')
    h.run(); assert.equal(h.render(), null)
    h.effects.find(effect => effect.deps.length === 1 && effect.deps[0] === true).fn()
    assert.equal(h.states[1], false)
  }
})
