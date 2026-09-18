import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const start = source.indexOf('function requestContextSections(')
const end = source.indexOf('function FullRequestContextView(', start)
const sections = vm.runInNewContext('(' + source.slice(start, end).trim() + ')')
test('system and tools precede messages while message, block and tool order remain unchanged', () => {
  const request = { tools: [{name:'z'}, {name:'a'}], messages: [
    {role:'user', content:[{type:'text',text:'first'}, {type:'text',text:'second'}]},
    {role:'assistant', content:[{type:'tool-call',id:'z'}, {type:'tool-call',id:'a'}]},
    {role:'tool', content:[{id:'a'}, {id:'z'}]},
    {role:'system', content:[], source:{sections:[{name:'tavern:runtime-preset-front'}]}}
  ], system:'', model:'fixture' }
  const before = JSON.stringify(request)
  const rows = sections(request)
  assert.deepEqual(Array.from(rows, r=>r.title.split(' · ')[0]), ['system','tools','messages[0]','messages[1]','messages[2]','messages[3]','model'])
  rows.slice(2,6).forEach((row,i)=>assert.equal(JSON.stringify(row.value),JSON.stringify(request.messages[i])))
  assert.equal(rows[1].text,JSON.stringify(request.tools,null,2))
  assert.equal(rows[0].value,'')
  assert.equal(JSON.stringify(request),before)
  assert.equal(sections({messages:[]})[0].text,'[]')
})
