import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/card-organization.js', import.meta.url), 'utf8')
const context = vm.createContext({})
vm.runInContext(source, context)

test('分组展示将星标置顶且不复制归属卡片，分组名不会与内置区块冲突', () => {
  const cards = [
    { path: 'a', group: '星标' }, { path: 'b', group: '' },
    { path: 'c', group: '星标', starred: true }, { path: 'd', group: '其他' }
  ]
  const result = JSON.parse(JSON.stringify(context.cardOrganizationSections(cards)))
  assert.deepEqual(result.map(section => section.key), ['starred', 'group:', 'group:星标', 'group:其他'])
  assert.deepEqual(result.flatMap(section => section.cards.map(card => card.path)), ['c', 'b', 'a', 'd'])
})
