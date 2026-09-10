import assert from 'node:assert/strict'
import test from 'node:test'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('插件命名空间与全局函数共享实现，context 在更新后读取真实身份', () => {
  const run = helperHostHarness({ chatId: 'one', playerName: '甲' })
  const w = run.window, context = w.SillyTavern.getContext()
  assert.equal(context, w.getContext())
  assert.equal(context.TavernHelper, w.TavernHelper)
  assert.equal(w.TavernHelper.getChatMessages, w.getChatMessages)
  const replacement = () => 8
  w.TavernHelper.getLastMessageId = replacement
  assert.equal(w.getLastMessageId, replacement)
  run.receive({ type: 'dsh-tavern-helper-context', context: { chatId: 'two', playerName: '乙' } })
  assert.equal(context.chatId, 'two')
  assert.equal(context.name1, '乙')
  assert.equal(w.TavernHelper.generateRaw, w.generateRaw)
})

test('createChatMessages 追加楼层并等待宿主确认后更新同步上下文', async () => {
  const run = helperHostHarness({
    messages: [{ message_id: 0, role: 'assistant', message: '正文', swipes: ['正文'], swipe_id: 0 }]
  })
  const w = run.window
  assert.equal(w.TavernHelper.createChatMessages, w.createChatMessages)

  const pending = w.createChatMessages([{
    role: 'assistant',
    message: '<chat_history target="楚青妤">回复</chat_history>',
    is_hidden: false,
    data: { phone: true }
  }])
  await tick()

  assert.deepEqual(JSON.parse(JSON.stringify(run.calls()[0])), {
    type: 'dsh-tavern-helper-call', token: 'host-test', requestId: '1',
    method: 'createTavernHelperMessages', args: {
      messages: [{ role: 'assistant', message: '<chat_history target="楚青妤">回复</chat_history>', is_hidden: false, data: { phone: true } }],
      option: {}
    }, eventId: '', scriptId: 'a', lifecycleRevision: 0
  })
  run.reply(run.calls()[0], {
    updated: true,
    context: { messages: [
      { message_id: 0, role: 'assistant', message: '正文', swipes: ['正文'], swipe_id: 0 },
      { message_id: 1, role: 'assistant', message: '<chat_history target="楚青妤">回复</chat_history>', swipes: ['<chat_history target="楚青妤">回复</chat_history>'], swipe_id: 0, variables: { phone: true } }
    ] }
  })
  assert.equal(await pending, undefined)
  assert.equal(w.getLastMessageId(), 1)
  assert.equal(w.getChatMessages('1')[0].message, '<chat_history target="楚青妤">回复</chat_history>')
})

test('Helper 与 ST 共用事件总线，支持去重、重新排序、异步等待和旧字符串', async () => {
  const w = helperHostHarness().window, seen = []
  const first = async value => { await tick(); seen.push('first:' + value) }
  const last = () => seen.push('last')
  const middle = () => seen.push('middle')
  w.eventOn('MESSAGE_SENT', last)
  w.eventOn('MESSAGE_SENT', middle)
  w.eventOn('MESSAGE_SENT', middle)
  w.SillyTavern.eventSource.makeFirst('message_sent', first)
  w.SillyTavern.eventSource.makeLast('MESSAGE_SENT', last)
  await w.SillyTavern.eventSource.emit(w.SillyTavern.eventTypes.MESSAGE_SENT, 3)
  assert.deepEqual(seen, ['first:3', 'middle', 'last'])
})

test('once 在回调前解绑，stop 保留所属脚本，不会移除另一个脚本监听', async () => {
  const w = helperHostHarness().window
  let once = 0, repeated = 0
  w.eventOnce('recursive', async () => { once++; await w.eventEmit('recursive') })
  await w.eventEmit('recursive')
  assert.equal(once, 1)
  const callback = () => repeated++
  const handle = w.eventOn('shared', callback)
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('shared', callback)
  handle.stop()
  await w.eventEmit('shared')
  assert.equal(repeated, 1)
  w.eventOff('shared', callback)
  await w.eventEmit('shared')
  assert.equal(repeated, 1)
})

test('宿主派发也遵循 first/once 顺序并返回完成回执', async () => {
  const run = helperHostHarness(), w = run.window, seen = []
  w.eventOn('MESSAGE_RECEIVED', () => seen.push('normal'))
  w.eventOnce('MESSAGE_RECEIVED', () => seen.push('once'))
  w.eventMakeFirst('MESSAGE_RECEIVED', () => seen.push('first'))
  for (const eventId of ['one', 'two']) {
    run.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', eventId, args: [0] })
    await tick()
    assert(run.sent.some(message => message.type === 'dsh-tavern-helper-event-complete' && message.eventId === eventId))
  }
  assert.deepEqual(seen, ['first', 'normal', 'once', 'first', 'normal'])
})

test('变量合并写入等待宿主保存，拒绝及过期结果均向插件报错', async () => {
  for (const method of ['insertVariables', 'insertOrAssignVariables']) {
    const run = helperHostHarness({ chatVariables: { old: 1 } }), w = run.window
    let settled = false
    const pending = w.TavernHelper[method]({ added: 2 }, { type: 'chat' }).then(value => { settled = true; return value })
    await tick()
    assert.equal(settled, false)
    assert.equal(w.getVariables({ type: 'chat' }).added, undefined)
    run.reply(run.calls()[0], { updated: true })
    assert.equal((await pending).added, 2)
    assert.equal(w.getVariables({ type: 'chat' }).added, 2)
    const failed = w[method]({ bad: 3 }, { type: 'chat' })
    run.reply(run.calls()[1], '保存失败', false)
    await assert.rejects(failed, /保存失败/)
    assert.equal(w.getVariables({ type: 'chat' }).bad, undefined)
    const stale = w[method]({ bad: 4 }, { type: 'chat' })
    run.reply(run.calls()[2], { stale: true, updated: false })
    await assert.rejects(stale, /未保存/)
  }
})

test('快速脚本先完成订阅时仍等待 iframe load，再宣布就绪和派发首个事件', async () => {
  const { helperClient } = await import('./fixtures/helper-host-harness.mjs')
  const listeners = {}, sent = [], ready = []
  let frame, emitted
  const hostWindow = { crypto: { randomUUID: () => 'early-ready' }, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners[name] = fn }, removeEventListener() {} }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'div') return root
    frame = { contentWindow: { postMessage(message) { sent.push(message) } }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn }, remove() {} }
    return frame
  } }
  const runtime = helperClient.createTavernHelperScriptRuntime({ window: hostWindow, document, rpc: async () => ({}), reportError() {}, resolveError() {},
    onReady(id) { ready.push(id); emitted = runtime.emit('MESSAGE_SENT', [1]) } })
  runtime.sync('audit', { tavernHelper: { messages: [] }, tavernHelperScripts: [{ id: 'quick', content: 'void 0' }] })
  listeners.message({ source: frame.contentWindow, data: { token: 'early-ready', type: 'dsh-tavern-helper-subscriptions', ready: true, names: ['MESSAGE_SENT'] } })
  assert.equal(ready.length, 0)
  await runtime.emit('MESSAGE_SENT', [0])
  assert.equal(sent.length, 0)
  frame.listeners.load()
  assert.deepEqual(ready, ['audit'])
  const event = sent.find(message => message.type === 'dsh-tavern-helper-event')
  assert(event, '首个事件必须真正发到 iframe，不能创建一个永远得不到回执的等待')
  listeners.message({ source: frame.contentWindow, data: { token: 'early-ready', type: 'dsh-tavern-helper-event-complete', eventId: event.eventId, args: [1] } })
  await emitted
  runtime.dispose()
})

test('普通脚本获得 Helper 接口但不误检测到 MVU 框架', () => {
  const w = helperHostHarness({ mvuEnabled: false }).window
  assert.equal(typeof w.TavernHelper.getVariables, 'function')
  assert.equal(w.Mvu, undefined)
})

for (const outcome of ['pending', 'failed']) test('其他脚本的提示词写入不阻塞或污染 CHAT_CHANGED：' + outcome, async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('a')
  w.injectPrompts([{ id: 'a-prompt', content: 'test' }])
  const write = h.calls()[0]
  if (outcome === 'failed') { h.reply(write, 'write A failed', false); await tick() }
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('CHAT_CHANGED', () => {})
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'b-event', name: 'CHAT_CHANGED', args: ['chat'] })
  await tick()
  const completed = h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete' && item.eventId === 'b-event')
  assert.ok(completed, 'B 必须独立完成，不等待 A 的写入')
  assert.equal(completed.error, undefined)
  if (outcome === 'pending') { h.reply(write, { updated: true }); await tick() }
})

for (const fails of [false, true]) test('事件等待自己的提示词持久化，并保留失败归属：' + fails, async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('CHAT_CHANGED', () => { w.injectPrompts([{ id: 'b-prompt', content: 'test' }]) })
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'own-event', name: 'CHAT_CHANGED', args: ['chat'] })
  await tick()
  assert.equal(h.sent.some(item => item.type === 'dsh-tavern-helper-event-complete'), false)
  h.reply(h.calls()[0], fails ? 'write B failed' : { updated: true }, !fails)
  await tick()
  const result = h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete')
  assert.ok(result)
  if (fails) { assert.equal(result.scriptId, 'b'); assert.match(result.error, /write B failed/) }
  else assert.equal(result.error, undefined)
})


test('generateRaw 返回独立 RPC 文本，不创建聊天消息', async () => {
  const run = helperHostHarness({ chatId: 'one' })
  const config = { ordered_prompts: [{ role: 'user', content: '生成档案' }], should_stream: false }
  const pending = run.window.TavernHelper.generateRaw(config)
  await tick()
  const request = run.calls().at(-1)
  assert.equal(request.method, 'generateTavernHelperRaw')
  assert.deepEqual(JSON.parse(JSON.stringify(request.args)), { config })
  run.reply(request, { text: '档案内容' })
  assert.equal(await pending, '档案内容')
  assert.equal(run.calls().length, 1)
})

test('异步 RPC 报错保留调用时的脚本和事件，不能署名最后加载的脚本', async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('a')
  const pending = w.insertVariables({ x: 1 }, { type: 'chat' })
  w.__dshTavernHelperSetCurrentScript('b')
  h.reply(h.calls()[0], '写入被拒绝', false)
  await assert.rejects(pending, error => error.dshTavernScriptId === 'a' && error.dshTavernMethod === 'updateTavernHelperVariables')
})

test('悬浮角色库读取当前人物卡名称，并随宿主上下文更新', () => {
  const run = helperHostHarness({ characterName: '命定之诗', character: { name: '命定之诗' } })
  assert.equal(run.window.getCurrentCharacterName(), '命定之诗')
  assert.equal(run.window.TavernHelper.getCurrentCharacterName(), '命定之诗')
  run.receive({ type: 'dsh-tavern-helper-context', context: { characterName: '新卡', character: { name: '新卡' } } })
  assert.equal(run.window.getCurrentCharacterName(), '新卡')
})

test('旧聊天 MVU 清理提示静默拒绝，不弹窗、不修改或清理历史变量', async () => {
  for (const content of [
    '检测到可以清理本聊天文件中的旧变量以减小文件体积，是否清理？（备份会消耗较多内存，手机上建议关闭其他后台应用后进行，或在计算机上备份）',
    'Old variables can be removed from this chat to reduce its file size. Clean them now? (Creating a backup uses considerable memory; on mobile, close other background apps first or create the backup on a computer.)'
  ]) {
    const run = helperHostHarness({ messages: [{ message_id: 0, variables: { stat_data: { hp: 10 } } }] })
    const before = JSON.stringify(run.window.getVariables({ type: 'message', message_id: 0 }))
    const result = await run.window.SillyTavern.callGenericPopup(content, 'confirm', '', {})
    assert.equal(result, run.window.SillyTavern.POPUP_RESULT.NEGATIVE)
    assert.equal(run.calls().length, 0)
    assert.equal(JSON.stringify(run.window.getVariables({ type: 'message', message_id: 0 })), before)
  }
})

test('script context exposes the bound character avatar and follows chat changes', () => {
  const run = helperHostHarness({ chatId: 'one', character: { name: 'A', path: 'cards/a.png' } })
  const ctx = run.window.SillyTavern.getContext()
  assert.equal(ctx.characters[ctx.characterId].avatar, 'cards/a.png')
  run.receive({ type: 'dsh-tavern-helper-context', context: { chatId: 'two', character: { name: 'B', path: 'cards/b.json', avatar: 'b.png' } } })
  assert.equal(ctx.characters[ctx.characterId].avatar, 'b.png')
  assert.equal(ctx.characters[ctx.characterId].name, 'B')
  ctx.characters[0].name = 'local mutation'
  assert.equal(ctx.characters[0].name, 'B')
  run.receive({ type: 'dsh-tavern-helper-context', context: { character: null } })
  assert.equal(ctx.characters.length, 0)
  assert.equal(ctx.characterId, undefined)
})
