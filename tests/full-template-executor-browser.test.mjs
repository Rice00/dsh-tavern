import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

for (const legacy of [false,true]) test(legacy ? '实际返回旧接口时，iframe 完成领取、投影、保存和回执' : '已有旧入口缓存时，正式 iframe 执行器按版本加载新版并领取任务', { skip: !process.env.TAVERN_BROWSER_TESTS }, async () => {
  const { chromium } = await import('playwright')
  const executor = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
  const entry = '/api/dsh-tavern/vendor/st-prompt-template/index.js'
  const visits = []
  const server = createServer((req, res) => {
    visits.push(req.url)
    res.setHeader('Content-Type', 'text/javascript')
    if (req.url.startsWith(entry)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      const current = !legacy && req.url.includes('?v=current')
      res.end(`export const templateHost={};export const createTemplateServices=()=>({});export const createTemplatePanel=()=>({});export async function connectTemplateSession({rpc}){return {context:{},synchronize:async()=>({}),project:async()=>({text:'rendered'}),flush:async()=>{},${current ? "processNext:async()=>{await rpc('claimFullTemplateWork',{ready:true});return false}" : ''}}}`)
    } else if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>Template upgrade</title>')
    } else res.end('')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port)
    assert.equal(await page.evaluate(async path => typeof (await (await import(path)).connectTemplateSession({})).processNext, entry), 'undefined')
    await page.addScriptTag({ content: 'function isPlayMode(){return true}\n' + executor })
    await page.evaluate(entry => {
      window.calls = []
      window.executor = createFullTemplateExecutor({ window, rpc: async (method, args) => {
        calls.push({method,args})
        if(method === 'getFullTemplateRuntimeInfo')return {entryUrl:entry+'?v=current'}
        if(method === 'claimFullTemplateWork' && !calls.some(call=>call.method==='startFullTemplateWork'))return {event:{id:'e',name:'render',args:['input']},leaseToken:'l'}
        if(method === 'startFullTemplateWork')return {started:true}
        return {}
      } })
      executor.sync('test', { chatId:'chat',mode:'story' })
    }, entry)
    await page.waitForFunction(() => calls.some(call => call.method === 'claimFullTemplateWork' && call.args.ready === true))
    if(legacy) {
      await page.waitForFunction(()=>calls.some(call=>call.method==='completeFullTemplateWork'))
      assert.equal(await page.evaluate(()=>calls.find(call=>call.method==='completeFullTemplateWork').args.args[0].text),'rendered')
    }
    assert.ok(visits.includes(entry + '?v=current'))
    assert.deepEqual(errors, [])
    await page.evaluate(() => executor.dispose())
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
