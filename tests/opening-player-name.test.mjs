import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const line = source.split('\n').find(line => line.includes('className: "dsh-tavern-player-name"'))
function input(state, update) {
  const tree = vm.runInNewContext(line.trim().replace(/,$/, ''), {
    h: (tag, props, ...children) => ({ tag, props, children }),
    openingPicker: state, busy: false, setOpeningPicker: update,
  })
  return tree.children.find(node => node?.tag === 'input').props
}

test('玩家称呼可清空再输入，不在编辑中强制填回默认称呼', () => {
  let state = { userName: '你', card: { path: 'test.json' } }
  const update = value => { state = typeof value === 'function' ? value(state) : value }
  input(state, update).onChange({ target: { value: '' } })
  assert.equal(input(state, update).value, '')
  input(state, update).onChange({ target: { value: '陈锋' } })
  assert.equal(input(state, update).value, '陈锋')
})

test('输入不覆盖同一期间返回的开场准备信息，也不恢复已关闭的面板', () => {
  let state = { userName: '你', preparationId: 'old' }
  const update = value => { state = typeof value === 'function' ? value(state) : value }
  const handler = input(state, update).onChange
  state = { ...state, preparationId: 'new' }
  handler({ target: { value: '玩家' } })
  assert.equal(state.preparationId, 'new')
  state = null
  handler({ target: { value: '玩家二' } })
  assert.equal(state, null)
})


test('默认玩家称呼确认中文候选时不失焦，普通 Enter 才保存', () => {
  const settingsLine = source.split('\n').find(line => line.includes('key: defaultPlayerName, className: "dsh-tavern-settings-text"'))
  const saved = []
  const tree = vm.runInNewContext(settingsLine.trim(), {
    React: { createElement: (tag, props) => ({ tag, props }) },
    defaultPlayerName: '', state: { loading: false },
    saveDefaultPlayerName: value => saved.push(value),
  })
  let prevented = 0
  let blurred = 0
  const event = {
    key: 'Enter', nativeEvent: { isComposing: true },
    preventDefault: () => prevented++,
    currentTarget: { blur: () => { blurred++; tree.props.onBlur({ target: { value: '陈锋' } }) } },
  }
  tree.props.onKeyDown(event)
  assert.equal(prevented, 0)
  assert.equal(blurred, 0)
  assert.deepEqual(saved, [])
  event.nativeEvent.isComposing = false
  tree.props.onKeyDown(event)
  assert.equal(prevented, 1)
  assert.equal(blurred, 1)
  assert.deepEqual(saved, ['陈锋'])
})
