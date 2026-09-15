import { createServer } from 'node:http'
import { after } from 'node:test'
import { chromium } from 'playwright'
import { readFullPromptTemplateAsset, FULL_PROMPT_TEMPLATE_ASSET_PREFIX } from '../../tavern-plugin/lib/domain/full-prompt-template-assets.js'
import { readTavernRuntimeAsset, TAVERN_RUNTIME_ASSET_PREFIX } from '../../tavern-plugin/lib/domain/tavern-runtime-assets.js'

let shared, cleanup
after(async () => { if (cleanup) await cleanup() })
export class UpstreamTemplateRuntime {
  static async create() { return shared ||= createRuntime() }
}
async function createRuntime() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost').pathname
      const asset = url.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX) ? await readFullPromptTemplateAsset(url) : await readTavernRuntimeAsset(url)
      if (asset) { res.setHeader('Content-Type', asset.mediaType); res.end(asset.body); return }
      res.setHeader('Content-Type', 'text/html'); res.end(html)
    } catch (error) { res.statusCode = 500; res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => { delete globalThis.structuredClone; delete Array.prototype.at })
  if(process.env.TEMPLATE_DEBUG) page.on('console', message => console.log(message.text()))
  cleanup = async () => { await browser.close(); await new Promise(resolve => server.close(resolve)) }
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.waitForFunction(() => window.testProject || window.bootError)
  const error = await page.evaluate(() => window.bootError)
  if (error) throw new Error(error)
  let tail = Promise.resolve()
  const run = (operation, input) => {
    const next = tail.then(() => page.evaluate(({ operation, input }) => window.testProject(operation, input), { operation, input: JSON.parse(JSON.stringify(input)) }))
    tail = next.catch(() => {})
    return next
  }
  return {
    page,
    panel: context => run('panel', { context }),
    renderInput: (text,context={}) => run('input',{text,context}),
    prepareWorldbook: (entries,context={}) => run('worldbook', {entries,context}),
    lifecycle: context => run('lifecycle', { context }),
    command: (text, context={}) => run('command', { text, context }),
    render: (template, context = {}) => run('render', { template, context }),
    renderMessages: (messages, context = {}) => run('messages', { messages, context }),
    projectRequest: request => run('request', { request }),
    initializeVariables: (entries, context = {}) => run('initialize', { context: { ...context, worldBookEntries: entries } })
  }
}
const html = `<!doctype html><div id="extensions_settings"></div>
<script src="${TAVERN_RUNTIME_ASSET_PREFIX}jquery/jquery.min.js"></script>
<script src="${TAVERN_RUNTIME_ASSET_PREFIX}lodash/lodash.min.js"></script>
<script type="module">
import * as YAML from '${TAVERN_RUNTIME_ASSET_PREFIX}yaml/index.mjs';
import {connectTemplateSession,createTemplateServices,createTemplatePanel,templateHost} from '${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}index.js';
window.toastr=Object.fromEntries(['info','success','warning','error'].map(k=>[k,()=>{}]));
let current,plugin;
window.YAML=YAML;window.testHost=templateHost;
window.SillyTavern={getContext:()=>plugin?.context};
function snapshot(context={}) {
 const book=context.worldBookEntries?.[0]?.world||'book';
 const entries=Object.fromEntries((context.worldBookEntries||[]).map((e,index)=>[e.uid??e.id??index,{vectorized:false,group:"",...e,uid:e.uid??e.id??index,key:e.key||e.primaryKeys||e.keys||[],keysecondary:e.secondaryKeys||[],comment:e.comment||e.title||e.name||e.ref||'',disable:e.enabled===false,order:e.order||100,content:e.content||'',position:e.position||0}]));
 const chat=(context.transcript?.length?context.transcript:[{role:'assistant',content:''}]).map(m=>({mes:m.content||'',name:context.charName||'',is_user:m.role==='user',variables:m.variables||[{}],swipe_id:0,swipes:[m.content||''],...m}));
 return {state:{sessionId:'fixture',chatId:'fixture',stateRevision:0,lifecycleRevision:0,chat,chat_metadata:{variables:{}}},environment:{characters:[{name:context.charName||'',data:{name:context.charName||'',extensions:{world:book}}}],this_chid:"0",name1:context.userName||'你',name2:context.charName||'',extension_settings:{regex:[],variables:{global:{}},EjsTemplate:{enabled:true,...context.settings}},world_names:[book],selected_world_info:[],worldbooks:{[book]:{entries}},dsh:{model:'fixture',cardPath:'fixture',regexScripts:[]}}};
}
const rpc=async(method,args)=>{
 if(method==='getFullTemplateWorldbook')return {worldbook:{name:'book',entries:Object.values(current.environment.worldbooks.book.entries).map(e=>({uid:e.uid,name:e.comment,content:e.content}))}};
 if(method==='replaceFullTemplateWorldbook'){for(const e of args.entries)current.environment.worldbooks.book.entries[e.uid].content=e.content;return {updated:true,worldbook:{name:'book',entries:args.entries}}};
 if(method==='getFullPromptTemplateState')return structuredClone(current);
 if(method==='saveFullPromptTemplateSettings'){current.environment.extension_settings.EjsTemplate=structuredClone(args.settings);return {updated:true,settings:args.settings};}
 if(method==='saveFullPromptTemplateGlobals')return {updated:true,variables:args.variables};
 if(method==='saveFullPromptTemplateState'){current.state=structuredClone(args.state);return {updated:true,state:args.state};}
 if(method==='countFullTemplateTokens')return {tokens:args.text.length};
 throw new Error('Unexpected fixture RPC '+method);
};
try {
 current=snapshot();const settingsHtml=await fetch('${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}settings.html').then(r=>r.text());
 plugin=await connectTemplateSession({sessionId:'fixture',rpc,settingsHtml,libraries:{yaml:YAML},services:createTemplateServices(()=>plugin?.context,rpc)});
 window.testProject=async(operation,input)=>{current=snapshot(input.context);await plugin.refresh();await plugin.emit('SETTINGS_LOADED');if(operation==='panel'){await plugin.emit('SETTINGS_LOADED');window.testPanel=createTemplatePanel({rpc,plugin,close:()=>{}});await window.testPanel.open();return true}if(operation==='lifecycle'){await plugin.synchronize();const first=structuredClone(current.state);await plugin.synchronize();return {first,second:structuredClone(current.state)}}return plugin.project(operation,input)};
}catch(error){window.bootError=String(error.stack||error)}
</script>`
