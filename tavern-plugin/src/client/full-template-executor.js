// Compatibility transport for template builds predating the session task queue.
// The official plugin still owns projection and persistence; never retry started work.
function createLegacyTemplateWorkProcessor(plugin, rpc, runtimeId) {
  return async function processNext() {
    const work = await rpc('claimFullTemplateWork', { runtimeId, ready: true });
    if (!work.event) return false;
    const identity = { runtimeId, eventId: work.event.id, leaseToken: work.leaseToken };
    const started = await rpc('startFullTemplateWork', identity);
    if (!started.started) return true;
    let receipt;
    try {
      let result;
      try { result = await plugin.project(work.event.name, work.event.args[0]); }
      finally { await plugin.flush(); }
      receipt = { args: [result] };
    } catch (error) { receipt = { error: String(error.stack || error) }; }
    await rpc('completeFullTemplateWork', { ...identity, ...receipt });
    return true;
  };
}

// A production instance of the complete upstream plugin, owned by the selected play session.
function createFullTemplateExecutor({ window: hostWindow, rpc: invoke, executeSlash }) {
  let owner = null;
  function dispose() {
    if (!owner) return;
    const old = owner; owner = null;
    hostWindow.removeEventListener('message', old.receive);
    hostWindow.removeEventListener('dsh-template-settings', old.open);
    old.frame.remove();
    void invoke('releaseFullTemplateRuntime', { runtimeId: old.token }, old.sessionId).catch(() => {});
  }
  function sync(sessionId, view) {
    if (!hostWindow.document || !view || !view.chatId || !isPlayMode(view.mode || 'story')) { dispose(); return; }
    if (owner && owner.sessionId === sessionId) { owner.frame.contentWindow?.postMessage({token:owner.token,type:'template-dirty'},'*'); return; }
    dispose();
    const frame = hostWindow.document.createElement('iframe');
    const token = hostWindow.crypto.randomUUID();
    frame.hidden = true;
    frame.title = '完整提示词模板';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const record = { frame, token, sessionId };
    record.receive = async event => {
      const data = event.data;
      if (owner !== record || event.source !== frame.contentWindow || data?.token !== token || !['full-template-rpc','template-close'].includes(data.type)) return;
      if(data.type === 'template-close') { frame.hidden=true; return; }
      try {
        if (!['getFullTemplateRuntimeInfo','getFullPromptTemplateState','saveFullPromptTemplateState','saveFullPromptTemplateSettings','saveFullPromptTemplateGlobals','countFullTemplateTokens','claimFullTemplateWork','startFullTemplateWork','completeFullTemplateWork','getFullTemplateWorldbook','replaceFullTemplateWorldbook','executeTemplateHostCommand'].includes(data.method)) throw new Error('Unsupported template RPC');
        const result = data.method === 'executeTemplateHostCommand' ? {pipe: await executeSlash(data.args.text, sessionId, {waitForCompletion:false}).then(value => typeof value === 'string' ? value : '')} : await invoke(data.method, data.args || {}, sessionId);
        if (result?.ok === false) throw new Error(result.error || 'Template RPC failed');
        if (owner === record) frame.contentWindow.postMessage({ token, requestId: data.requestId, result }, '*');
      } catch (error) {
        if (owner === record) frame.contentWindow.postMessage({ token, requestId: data.requestId, error: String(error.message || error) }, '*');
      }
    };
    record.open = event => { if(event?.detail)event.detail.handled=true; frame.hidden=false; Object.assign(frame.style,{position:'fixed',inset:'3vh 3vw',width:'94vw',height:'94vh',zIndex:'2147483000',border:'1px solid #777',borderRadius:'12px'});frame.contentWindow.postMessage({token,type:'template-open'},'*'); };
    hostWindow.addEventListener('dsh-template-settings',record.open);
    owner = record;
    hostWindow.addEventListener('message', record.receive);
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><div id="extensions_settings"></div>
<script src="/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js"></script>
<script src="/api/dsh-tavern/vendor/runtime-assets/lodash/lodash.min.js"></script>
<script type="module">
import * as YAML from '/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs';

const token=${JSON.stringify(token)},sessionId=${JSON.stringify(sessionId)},runtimeId=token;
let sequence=0,context,plugin,panel,templateHost,dirty=true,panelRequested=false,lastSync=0;const pending=new Map();
const rpc=(method,args={})=>new Promise((resolve,reject)=>{const requestId=++sequence;pending.set(requestId,{resolve,reject});parent.postMessage({type:'full-template-rpc',token,requestId,method,args},'*')});
addEventListener('message',event=>{if(event.source!==parent||event.data?.token!==token)return;const data=event.data;if(data.type==='template-dirty'){dirty=true;return}if(data.type==='template-open'){panelRequested=true;return}const item=pending.get(data.requestId);if(!item)return;pending.delete(data.requestId);data.error?item.reject(new Error(data.error)):item.resolve(data.result)});
window.toastr=Object.fromEntries(['info','success','warning','error'].map(key=>[key,message=>console[key==='error'?'error':'log'](message)]));
window.YAML=YAML;
window.SillyTavern={getContext:()=>Object.assign({},context,templateHost)};
async function run(){
 try {
  const {entryUrl}=await rpc('getFullTemplateRuntimeInfo');
  const templateModule=await import(new URL(entryUrl,document.baseURI).href);
  const {connectTemplateSession,createTemplateServices,createTemplatePanel}=templateModule;templateHost=templateModule.templateHost;
  const settingsHtml=await fetch('/api/dsh-tavern/vendor/st-prompt-template/settings.html').then(r=>r.text());
  plugin=await connectTemplateSession({sessionId,runtimeId,rpc,settingsHtml,libraries:{yaml:YAML},services:createTemplateServices(()=>context,rpc)});
  const methods=Object.keys(plugin || {}).sort();
  for(const method of ['project','flush','synchronize']) if(typeof plugin?.[method]!=='function') throw new Error('完整提示词模板版本不匹配：缺少 '+method+'；入口 '+entryUrl+'；接口 '+methods.join(',')+'，请更新酒馆并刷新页面');
  const processNext=typeof plugin.processNext==='function' ? ()=>plugin.processNext() : (${createLegacyTemplateWorkProcessor.toString()})(plugin,rpc,runtimeId);
  if(typeof plugin.processNext!=='function')console.warn('完整模板使用旧版任务接口', {entryUrl,methods});
  context=plugin.context;
  panel=createTemplatePanel({rpc,plugin,close:()=>parent.postMessage({token,type:'template-close'},'*')});
  while(true){
   try {
   if(!await processNext()) {
    if(panelRequested){panelRequested=false;await panel.open()}
    if(!sessionId.startsWith('opening:') && dirty && Date.now()-lastSync>1000){dirty=false;lastSync=Date.now();try{const result=await plugin.synchronize();if(result.deferred)dirty=true;}catch(error){console.error('模板消息同步失败',error);dirty=true;}}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   }catch(error){console.error('完整模板连接中断，正在重连',error);await new Promise(resolve=>setTimeout(resolve,1000));}
  }
 }catch(error){console.error('完整模板初始化失败',error);await rpc('claimFullTemplateWork',{runtimeId,ready:false,initializationError:String(error.stack||error)});}
}
run();
</script>`;
    hostWindow.document.body.appendChild(frame);
  }
  return { sync, dispose };
}

async function initializeFullOpeningTemplate(response) {
  if (!response.preparationId) return response;
  const id = 'opening:' + response.preparationId;
  const executor = createFullTemplateExecutor({ window, rpc });
  try {
    executor.sync(id, { mode: 'story', chatId: response.preparationId });
    const prepared = await rpc('initializeOpeningTemplate', { id: response.preparationId }, id);
    for (const opening of response.openings || []) if (opening.openingPreview) opening.openingPreview.runtime = prepared.runtime;
    return response;
  } finally { executor.dispose(); }
}
