import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const source=await readFile(new URL('../../tavern-plugin/src/client/stylesheet.js',import.meta.url),'utf8');
let requests=0,failures=1;
const server=createServer((req,res)=>{
 if(req.url.startsWith('/style')){
  requests++;
  if(failures-->0){res.writeHead(502);res.end('Bad Gateway');return}
  res.writeHead(200,{'Content-Type':'text/css'});res.end('.probe{display:flex;color:'+ (req.url.includes('old')?'rgb(0, 0, 255)':'rgb(255, 0, 0)') +'}');return;
 }
 res.end('<div class="probe">DSH Tavern</div>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.addScriptTag({content:source+';window.install=installTavernStylesheet;'});
 await page.evaluate(()=>install(document,'/style?v=initial'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.probe')).display==='flex');
 assert.equal(requests,2,'a failed first request retries without reloading the page');
 await page.evaluate(()=>install(document,'/style?v=old'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.probe')).color==='rgb(0, 0, 255)');
 failures=100;const before=requests;
 await page.evaluate(()=>{install(document,'/style?v=new');install(document,'/style?v=new')});
 await page.waitForTimeout(4200);
 assert.equal(requests-before,4,'retries are bounded and duplicate factories do not multiply requests');
 assert.equal(await page.locator('.probe').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 255)','failed update retains previous CSS');
 failures=0;
 await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.probe')).color==='rgb(255, 0, 0)');
 assert.equal(requests-before,5);
 assert.equal(await page.locator('link[data-plugin-css]').count(),1);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(100);
 assert.equal(requests-before,5,'success removes recovery listeners');
 console.log('PASS: initial failure recovers, update keeps old styles, retries bounded, online/focus recovery');
}finally{await browser.close();server.close()}
