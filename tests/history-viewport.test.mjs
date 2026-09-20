import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/history-viewport.js', import.meta.url), 'utf8')
const make = new Function(source + ';return createTavernHistoryViewport')()
test('live window never exceeds 20, evicts before publishing, and counts multiple nodes as one turn', () => {
  const budget = make(), released = []
  const stops = []
  for (let turn = 1; turn <= 133; turn++) {
    stops.push(budget.register('a', turn, () => released.push(turn)))
    assert.ok(budget.snapshot().size <= 20)
  }
  assert.equal(budget.snapshot().size, 20)
  assert.ok(budget.snapshot().has(budget.key('a', 133)))
  const stopDuplicate = budget.register('a', 1, () => {})
  budget.focus('a', 1)
  assert.equal(budget.snapshot().size, 20)
  assert.ok(budget.snapshot().has(budget.key('a', 1)))
  stops[0]()
  assert.ok(budget.snapshot().has(budget.key('a', 1)))
  stopDuplicate()
  assert.equal(budget.snapshot().has(budget.key('a', 1)), false)
  assert.ok(released.includes(133))
  budget.register('a', 134, () => {})
  assert.equal(budget.snapshot().has(budget.key('a', 134)), false, 'new replies do not evict history being read')
})

const dsh = process.env.DSH_BROWSER_ROOT || path.join(homedir(), '.dsh-tavern/runtime/lib/node_modules/@deepseek-ai/dsh')
test('real React scrolls 133 rounds with at most 20 retained pages and recreates evicted history', { skip: !existsSync(dsh) && 'Set DSH_BROWSER_ROOT for the browser integration test' }, async () => {
  const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
  const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
  const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
  let bundle = 'const modules={};\n'
  for (let i = 0; i < names.length; i++) {
    const text = await readFile(path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i]), 'utf8')
    bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${text}\nreturn module.exports;})();\n`
  }
  const retained = await readFile(new URL('../tavern-plugin/src/client/modules/retained-message-frames.js', import.meta.url), 'utf8')
  const retention = await readFile(new URL('../tavern-plugin/src/client/modules/session-resource-retention.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({content: bundle + `
      const React=modules.react;
      ${retention}\n${retained}\n${source}
      const retention=createTavernSessionRetention({window});retention.select('a');
      const tavernRetainedFrames=createRetainedTavernFrames({window,retention,createLifecycle(props){
        const d={token:Math.random().toString(),trustedCardMode:true,html:'<input value="fresh"><script>window.identity=Math.random()</'+'script>',ref(){}};
        return {snapshot(){return {height:160,visibleDocument:d}},start(){return ()=>{}},update(){}};
      }});
      function Body(props){const ref=React.useRef(null);React.useLayoutEffect(()=>{
        const lease=tavernRetainedFrames.mount({sessionId:'a',turn:props.node.location.turn.turn,partIndex:0,frameOwner:props.frameOwner},ref.current);
        return ()=>lease.detach();
      },[]);return React.createElement('div',{ref,style:{height:160}});}
      const root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
      root.render(React.createElement(React.Fragment,null,Array.from({length:133},(_,i)=>React.createElement(TavernWindowedNode,{key:i,sessionId:'a',node:{location:{turn:{turn:i+1}}},bodyComponent:Body}))));
      window.budget=tavernHistoryViewport;
      window.maxFrames=0;new MutationObserver(()=>{maxFrames=Math.max(maxFrames,document.querySelectorAll('iframe').length)}).observe(document.body,{subtree:true,childList:true});
    `})
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 20)
    for (const turn of [133, 1, 65, 133, 1]) {
      await page.locator(`[data-tavern-history-turn="${turn}"]`).scrollIntoViewIfNeeded()
      await page.waitForFunction(turn => document.querySelector(`[data-tavern-history-turn="${turn}"] iframe`), turn)
      assert.ok(await page.locator('iframe').count() <= 20)
    }
    await page.evaluate(() => { window.oldFrame = document.querySelector('[data-tavern-history-turn="1"] iframe'); oldFrame.contentDocument.querySelector('input').value = 'old-state' })
    await page.locator('[data-tavern-history-turn="133"]').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => !oldFrame.isConnected)
    await page.locator('[data-tavern-history-turn="1"]').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('[data-tavern-history-turn="1"] iframe')?.contentDocument?.querySelector('input'))
    assert.equal(await page.evaluate(() => document.querySelector('[data-tavern-history-turn="1"] iframe') !== oldFrame), true)
    assert.ok(await page.evaluate(() => maxFrames) <= 20)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
