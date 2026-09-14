import test from 'node:test'
import assert from 'node:assert/strict'
import { createTavernSkillProvider } from '../tavern-plugin/lib/domain/tavern-skill-provider.js'

test('本局关闭后目录与直接加载均不可用，其他游戏不受影响', async () => {
  const skill = { name: 'writing', path: '/skills/writing', agents: ['foreground'] }
  const disabled = new Map()
  const provider = createTavernSkillProvider({
    providers: [{ list: async () => [skill], get: async () => skill }],
    library: { read: async () => skill }, roleFor: async () => 'foreground',
    enabledFor: async (item, scope) => !(disabled.get(scope) || []).includes(item.name)
  })
  const first = (await provider.list({ scope: 'a' })).candidates[0]
  assert.ok(first)
  disabled.set('a', ['writing'])
  assert.equal((await provider.list({ scope: 'a' })).candidates.length, 0)
  assert.equal(await provider.get(first, { scope: 'a' }), undefined)
  assert.equal((await provider.list({ scope: 'b' })).candidates.length, 1)
  disabled.set('a', [])
  assert.ok(await provider.get(first, { scope: 'a' }))
})
