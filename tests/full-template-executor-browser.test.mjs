import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('settings panel saves to the server and commands never execute in a browser iframe', {skip:!process.env.TAVERN_BROWSER_TESTS}, async()=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage()
    const source=await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js',import.meta.url),'utf8')
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({content:'function isPlayMode(){return true}\n'+source})
    await page.evaluate(()=>{
      window.calls=[]
      window.panel=createServerTemplatePanel({window,rpc:async(method,args,id)=>{
        calls.push({method,args,id})
        if(method==='getFullPromptTemplateState')return {environment:{extension_settings:{EjsTemplate:{enabled:true,render_enabled:true}}}}
        if(method==='saveFullPromptTemplateSettings')return {updated:true,settings:args.settings}
        if(method==='executeFullTemplateCommand')return {pipe:'0'}
        if(method==='getFullTemplateWorldbook')return {worldbook:{name:'current',entries:[{uid:1,comment:'A',content:'one'},{uid:2,comment:'B',content:'two'}]}}
        if(method==='replaceFullTemplateWorldbook')return {updated:true,worldbook:{name:'current',entries:args.entries}}
      }})
      panel.sync('s',{chatId:'c'})
      window.dispatchEvent(new CustomEvent('dsh-template-settings',{detail:{openCodeEditor: request => { window.editorRequest=request; request.onApply('edited code'); }}}))
    })
    await page.getByLabel('启用提示词模板').uncheck()
    await page.getByRole('button',{name:'保存设置'}).click()
    await page.getByRole('status').filter({hasText:'已保存'}).waitFor()
    await page.getByLabel('模板命令').fill('/ejs <%= 1+1 %>')
    await page.getByRole('button',{name:'执行模板命令'}).click()
    await page.getByRole('status').filter({hasText:'0'}).waitFor()
    await page.getByRole('button',{name:'EJS 代码编辑'}).click()
    assert.equal(await page.getByLabel('条目正文').inputValue(),'edited code')
    await page.getByLabel('世界书条目',{exact:true}).selectOption('1')
    await page.getByLabel('条目正文').fill('second draft')
    await page.getByLabel('世界书条目',{exact:true}).selectOption('0')
    assert.equal(await page.getByLabel('条目正文').inputValue(),'edited code')
    await page.getByRole('button',{name:'保存条目'}).click()
    await page.waitForFunction(()=>calls.some(c=>c.method==='replaceFullTemplateWorldbook'))
    const saved=await page.evaluate(()=>calls.find(c=>c.method==='replaceFullTemplateWorldbook').args)
    assert.deepEqual(saved.entries.map(e=>e.content),['edited code','second draft'])
    assert.deepEqual(saved.expectedEntries.map(e=>e.content),['one','two'])
    assert.equal(await page.locator('iframe').count(),0)
    assert.equal(await page.evaluate(()=>calls.find(c=>c.method==='saveFullPromptTemplateSettings').args.settings.enabled),false)
    assert.ok(await page.evaluate(()=>calls.every(c=>c.id==='s')))
    await page.evaluate(()=>panel.sync('other',{chatId:'other'}))
    assert.equal(await page.locator('dialog').count(),0)
  } finally {await browser.close()}
})
