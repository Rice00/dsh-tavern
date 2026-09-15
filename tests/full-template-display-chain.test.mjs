import assert from 'node:assert/strict'
import test from 'node:test'
import {UpstreamTemplateRuntime} from './fixtures/upstream-template-runtime.mjs'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const runtime=await UpstreamTemplateRuntime.create()
const settings={preload_worldinfo_enabled:false,raw_message_evaluation_enabled:true}
const transcript=state=>state.chat.map(m=>({...m,content:m.mes}))
const display=(state,regexScripts)=>{
 const messages=state.chat.map(m=>({role:m.is_user?'user':'assistant',turn:1,text:m.mes,sourceText:m.mes,swipeId:m.swipe_id,tavernPluginData:m}))
 return projectPersistentStatusView(messages,projectReplyHistory(messages,{regexScripts}).projections,{regexScripts})
}
test('显示正则先于 EJS，独立侧栏保留模板结果且正文不重复面板',async()=>{
 const source='正文\n<StatusPlaceHolderImpl/>'
 const regexScripts=[{enabled:true,placement:[2],markdownOnly:true,findRegex:'/<StatusPlaceHolderImpl\\s*\\/>/g',replaceString:'```html\n<html><body><p>数值=<%= 1+2 %></p><script>const value=<%- 1+2 %>;function loadStatus(){window.mounts=(window.mounts||0)+1;window.value=value}loadStatus()</script></body></html>\n```'}]
 const result=await runtime.lifecycle({settings,charName:'状态组合',regexScripts,transcript:[{role:'assistant',content:source}],worldBookEntries:[{uid:1,enabled:false,constant:true,content:'@@render_before\n显示前缀'}]})
 assert.equal(result.first.chat[0].mes,source)
 const view=display(result.first,regexScripts)
 assert.equal(view.statusViews.length,1)
 assert.match(view.statusView.content,/>3</)
 assert.match(view.statusView.content,/const value=3;/)
 assert.doesNotMatch(view.statusView.content,/<%|&lt;%/)
 assert.match(JSON.stringify(view.projections),/显示前缀/)
 assert.doesNotMatch(JSON.stringify(view.projections),/loadStatus/)
 assert.deepEqual(result.second.chat,result.first.chat)
 assert.equal(await runtime.page.evaluate(()=>window.mounts),undefined)
 await runtime.page.evaluate(content=>{const frame=document.createElement('iframe');frame.id='chain-status';frame.srcdoc=content;document.body.append(frame)},view.statusView.content)
 await runtime.page.waitForFunction(()=>document.querySelector('#chain-status')?.contentWindow.mounts===1)
 assert.equal(await runtime.page.evaluate(()=>document.querySelector('#chain-status').contentWindow.value),3)
 await runtime.page.locator('#chain-status').evaluate(frame=>frame.remove())
})
test('聊天和全局变量刷新显示，不重复永久模板副作用',async()=>{
 const context={settings,charName:'变量刷新',worldBookEntries:[{uid:2,enabled:false,constant:true,content:'@@render_before\n地点=<%= getvar("place") %>，全局=<%= getGlobalVar("weather") %>'}]}
 const a=await runtime.lifecycle({...context,chatVariables:{place:'甲'},globalVariables:{weather:'晴'},transcript:[{role:'assistant',content:'<% setMessageVar("count", (getMessageVar("count") || 0)+1) %>正文'}]})
 const b=await runtime.lifecycle({...context,chatVariables:{place:'乙'},globalVariables:{weather:'雨'},transcript:transcript(a.first)})
 assert.match(b.first.chat[0].template_display.html,/乙/)
 assert.match(b.first.chat[0].template_display.html,/雨/)
 assert.equal(b.first.chat[0].variables[0].count,1)
 assert.deepEqual(b.second.chat,b.first.chat)
})
test('用户输入显示正则与模板串联，不改变提交的输入',async()=>{
 const r=await runtime.renderInput('输入[面板]',{settings,regexScripts:[{enabled:true,placement:[1],markdownOnly:true,findRegex:'/\\[面板\\]/g',replaceString:'<div>结果=<%= 2+3 %></div>'}]})
 assert.equal(r.message.mes,'输入[面板]')
 assert.match(r.message.template_display.html,/>5</)
 assert.doesNotMatch(r.message.template_display.html,/<%|&lt;%/)
})
test('修改显示正则会刷新快照，且不把替换结果重复作为输入',async()=>{
 const rule={enabled:true,placement:[2],markdownOnly:true,findRegex:'/标记/g',replaceString:'<b>标记第一版</b>'}
 const context={settings,charName:'规则刷新'}
 const a=await runtime.lifecycle({...context,regexScripts:[rule],transcript:[{role:'assistant',content:'标记'}]})
 const b=await runtime.lifecycle({...context,regexScripts:[{...rule,replaceString:'<b>第二版</b>'}],transcript:transcript(a.first)})
 assert.match(b.first.chat[0].template_display.html,/第二版/)
 assert.doesNotMatch(b.first.chat[0].template_display.html,/第一版/)
 assert.equal(b.first.chat[0].mes,'标记')
 const c=await runtime.lifecycle({...context,regexScripts:[{...rule,enabled:false}],transcript:transcript(b.first)})
 assert.equal(c.first.chat[0].template_display,undefined)
})
test('新增楼层后，旧消息显示重新遵守正则深度限制',async()=>{
 const rule={enabled:true,placement:[2],markdownOnly:true,maxDepth:0,findRegex:'/标记/g',replaceString:'<b>面板</b>'}
 const context={settings,charName:'深度刷新',regexScripts:[rule]}
 const a=await runtime.lifecycle({...context,transcript:[{role:'assistant',content:'标记'}]})
 const b=await runtime.lifecycle({...context,transcript:[...transcript(a.first),{role:'user',content:'继续'}]})
 assert.equal(b.first.chat[0].template_display,undefined)
})
