import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('function TavernMoreActions(props)'), source.indexOf('function CandidateDockActions(props)'))
test('批量错误按钮等待保存并展示实际处理数量，切换会话丢弃迟到响应', async () => {
  const states = [], refs = [], effects = [], calls = [], views = []
  let cursor = 0, refCursor = 0, resolve
  const component = vm.runInNewContext('(' + body.trim() + ')', {
    React: {
      useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
      useRef(initial) { return refs[refCursor++] ||= { current: initial } }, useEffect(fn) { effects.push(fn) },
      createElement: (type, props, ...children) => ({ type, props, children })
    },
    rpc: (method, args) => { calls.push({ method, args }); return new Promise(done => { resolve = done }) },
    liveTavernView: { setView: (...args) => views.push(args) },
    TavernStopBackgroundAction() {}, TavernEditBodyAction() {}, TavernRollbackAction() {}, TavernUndoRollbackAction() {}, TavernCompactionAction() {}
  })
  function tree(sessionId = 'a') {
    cursor = 0; refCursor = 0; effects.length = 0
    const nodes = []
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); node.children?.forEach(visit) }
    visit(component({ sessionId })); return nodes
  }
  tree(); const dispose = effects[0]()
  const hide = () => tree().find(node => node.children.includes('隐藏全部错误提示'))
  const work = hide().props.onClick()
  assert.equal(hide().props.disabled, true)
  resolve({ view: {}, changedCount: 2 }); await work
  assert.equal(tree().find(node => node.props?.role === 'status').children[0], '已隐藏 2 轮错误提示')
  assert.equal(calls[0].method, 'setAllFailedErrorVisibility')
  assert.equal(calls[0].args.sessionId, 'a')
  const late = hide().props.onClick()
  dispose(); tree('b'); effects[0]()
  resolve({ view: {}, changedCount: 10 }); await late
  assert.equal(views.length, 1)
  assert.equal(tree('b').some(node => node.props?.role === 'status'), false)
})
