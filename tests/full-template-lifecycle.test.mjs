import assert from 'node:assert/strict'
import test from 'node:test'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
const runtime = await UpstreamTemplateRuntime.create()

test('官方永久渲染写入正文，刷新快照不会再次运行变量副作用', async () => {
  const result = await runtime.lifecycle({settings:{preload_worldinfo_enabled:false},transcript:[{role:'assistant',content:'<% setMessageVar("count", (getMessageVar("count") || 0) + 1) %>值 <%= getMessageVar("count") %>'}]})
  assert.equal(result.first.chat[0].mes,'值 1')
  assert.equal(result.first.chat[0].variables[0].count,1)
  assert.deepEqual(result.second.chat,result.first.chat)
})

test('官方 render_before/render_after 渲染用户与回复，显示内容不污染正文', async () => {
  const result = await runtime.lifecycle({settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:false},transcript:[{role:'user',content:'玩家动作'},{role:'assistant',content:'角色回复'}],worldBookEntries:[
    {uid:1001,comment:'[render] Before',enabled:false,constant:true,content:'@@render_before\n前缀'},
    {uid:1002,comment:'[render] After',enabled:false,constant:true,content:'@@render_after\n后缀'}]})
  assert.equal(result.first.chat[0].mes,'玩家动作')
  assert.equal(result.first.chat[1].mes,'角色回复')
  for(const message of result.first.chat) {
    assert.match(message.template_display.html,/前缀/)
    assert.match(message.template_display.html,/后缀/)
  }
})

test('官方命令接受上下文 JSON，保留代码中的空格与逻辑运算', async () => {
  const result=await runtime.command('/ejs ctx={"x": 3} block=true x || 7')
  assert.equal(result.pipe,'3')
})

test('官方世界书加载事件过滤条件和专用条目，预处理正文及关键词', async () => {
  const entries=[
    {uid:1201,comment:'hidden',disable:false,content:'@@if false\n不能注入'},
    {uid:1202,comment:'render',disable:true,content:'@@render_before\n显示专用'},
    {uid:1203,comment:'prepare',disable:false,content:'@@preprocessing\n值 <%= 1+2 %>',key:['<%= "角色" %>'],keysecondary:[]}
  ]
  const result=await runtime.prepareWorldbook(entries)
  assert.deepEqual(result.entries.map(e=>e.uid),[1203])
  assert.equal(result.entries[0].content,'值 3')
  // Pinned upstream evalTemplateWI currently evaluates content for each key too.
  assert.deepEqual(result.entries[0].key,['值 3'])
})

test('上游设置与 Monaco 编辑器实际加载，保存/取消与条目保存使用同一实例', async () => {
  await runtime.panel({worldBookEntries:[{uid:1301,comment:'编辑样例',content:'原文 <%= 1 %>'}]})
  const page=runtime.page
  const listeners=await page.evaluate(()=>window.testHost.eventSource.count())
  await page.locator('#pt_code_editor').check()
  // Upstream lazy loader registers APP_READY only after Monaco is ready.
  await page.waitForFunction(count=>window.testHost.eventSource.count()>count, listeners, {timeout:20000})
  await page.getByRole('button',{name:'展开编辑',exact:true}).click()
  await page.getByRole('button',{name:'Monaco 编辑',exact:true}).waitFor({state:'visible',timeout:20000})
  await page.getByRole('button',{name:'Monaco 编辑',exact:true}).click()
  await page.locator('.monaco-editor').waitFor({state:'visible'})
  await page.locator('.monaco-editor .view-lines').click()
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('取消内容')
  await page.getByRole('button',{name:'取消',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'条目正文',exact:true}).inputValue(),'原文 <%= 1 %>')
  await page.getByRole('button',{name:'Monaco 编辑',exact:true}).click()
  await page.locator('.monaco-editor .view-lines').click()
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText('已保存的模板正文')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'条目正文',exact:true}).inputValue(),'已保存的模板正文')
  await page.getByRole('button',{name:'保存条目',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已保存'}).waitFor()
})

test('玩家输入在召回前执行官方渲染，返回新变量且不提前提交一个聊天楼层', async () => {
  const result = await runtime.renderInput('<% setMessageVar("place", "少林") %>进入<%= getMessageVar("place") %>', {settings:{raw_message_evaluation_enabled:true},transcript:[{role:'assistant',content:'开场',variables:[{hp:7}]}],scopes:{global:{},local:{},initial:{},message:{hp:7}}})
  assert.equal(result.message.mes,'进入少林')
  assert.deepEqual(result.message.variables[0],{hp:7,place:'少林'})
  assert.equal(result.message.is_ejs_processed[0],true)
  assert.equal(result.scopes.message.place,'少林')
})

test('显示脚本在真正展示的 frame 执行一次，格式化镜像不执行脚本或事件属性', async () => {
  const content='<p>正文</p><script>window.__visibleCount=(window.__visibleCount||0)+1</script><img src="data:image/png,broken" onerror="window.__imageFired=true">正文'
  const result=await runtime.lifecycle({settings:{preload_worldinfo_enabled:false,raw_message_evaluation_enabled:true},transcript:[{role:'assistant',content}],worldBookEntries:[{uid:1401,comment:'render',constant:true,enabled:false,content:'@@render_before\n前缀'}]})
  const page=runtime.page
  await page.waitForFunction(()=>document.querySelector('#chat img')?.complete)
  assert.equal(await page.evaluate(()=>window.__visibleCount),undefined)
  assert.equal(await page.evaluate(()=>window.__imageFired),undefined)
  const html=result.first.chat[0].template_display.html
  assert.match(html,/onerror=/)
  await page.evaluate(html=>{const frame=document.createElement('iframe');frame.id='visible-test';frame.srcdoc=html;document.body.append(frame)},html)
  await page.waitForFunction(()=>document.querySelector('#visible-test')?.contentWindow.__imageFired===true)
  assert.equal(await page.evaluate(()=>document.querySelector('#visible-test').contentWindow.__visibleCount),1)
  await page.locator('#visible-test').evaluate(frame=>frame.remove())
})


test('上游可选 Worker 编译使用本地完整 EJS，正常结果与语法错误均返回', async () => {
  const context={settings:{compile_workers:true,preload_worldinfo_enabled:false}}
  const result=await runtime.render('值 <%= _.keyBy([{id:"a",n:7}],"id").a.n %>',context)
  assert.equal(result.text,'值 7')
  const invalid=await runtime.render('<% const = %>',context)
  assert.equal(invalid.ok,false)
  await runtime.render('恢复',{settings:{compile_workers:false}})
})
