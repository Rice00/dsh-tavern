import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const start = source.indexOf('function requestContextSections(')
const end = source.indexOf('function FullRequestProjection(', start)
const sections = vm.runInNewContext('(' + source.slice(start, end).trim() + ')')
test('context keeps actual message order including front preset and trailing projection', () => {
  const message = (text, phase) => ({ role: 'user', content: [{type:'text', text}], source: {sections: phase ? [{name:'tavern:runtime-preset-' + phase}] : []} })
  const request = { system: '', messages: [message('前段', 'front'), message('history'), message('尾部', 'back')] }
  const before = JSON.stringify(request)
  const rows = sections(request)
  assert.match(rows[0].title, /前段预设/)
  assert.match(rows[2].title, /末尾预设投影/)
  assert.equal(JSON.stringify(rows.slice(0,3).map(row => row.value)), JSON.stringify(request.messages))
  assert.equal(JSON.stringify(request), before)
  assert.equal(sections({...request, system:'system'})[0].value, 'system')
})
