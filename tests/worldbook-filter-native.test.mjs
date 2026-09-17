import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { createWorldbookFilter, WORLD_BOOK_FILTER_TOOLS } from '../tavern-plugin/lib/domain/worldbook-filter.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('原生 DSH 筛选工具、结算与重启恢复使用同一后台 Session 和固定背景', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-filter-native-'))
  let ctx, parent, runner
  t.after(async () => {
    await runner?.dispose()
    await parent?.dispose()
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href +
    (name === 'dsh-session-persistence-jsonl' ? '\n  config:\n    root: ' + join(root, 'sessions') + '\n    compression: none' : '')).join('\n'))
  ctx = await boot('worldbook-filter-native-test', config)
  const requests = []
  class Model extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(input) {
      requests.push(structuredClone({ system: input.system, messages: input.messages, tools: input.tools }))
      const current = input.messages.filter(message => message.role === 'user').at(-1)
      const filtering = JSON.stringify(current).includes('任务类型：世界书筛选')
      const block = filtering
        ? { type: 'tool-call', id: 'filter-' + requests.length, name: 'worldbook_filter_submit', arguments: JSON.stringify({ selected: ['entry:0'] }) }
        : { type: 'text', text: '结算完成' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: filtering ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['filter-fixture'], new Model())
  for (const name of ['skill', 'tavern_read_skill_reference', 'web_search']) ctx.tools.register({
    name, description: 'Fixture tool', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'fixture'
  })
  const selection = { provider: 'filter-fixture', model: 'scripted' }
  parent = await ctx.agents.create({ sessionId: 'parent', agentOptions: selection })
  let chat = { id: 'game', sessionId: 'parent', messages: [] }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: {
    readChat: async () => structuredClone(chat), writeChat: async value => { chat = structuredClone(value) },
    updateChat: async (_id, update) => { chat = update(structuredClone(chat)); return structuredClone(chat) }
  } })
  const makeRunner = () => createBackgroundAgentRunner({ agents: ctx.agents, backgroundTools: WORLD_BOOK_FILTER_TOOLS,
    resolveStablePrefix: async () => '固定背景：雨夜旅店', flushSession: session => ctx.sessions.flush(session) })
  runner = makeRunner()
  const filter = createWorldbookFilter({ selection: () => selection, runAgent: input => runner.run(input), beginTask: value => tasks.begin(value, 'worldbook-filter') })
  const candidates = Array.from({ length: 6 }, (_, n) => ({ ref: 'entry:' + n, text: '资料' + n, tokenCost: 10 }))
  const first = await filter({ chat, userText: '首次筛选', candidates })
  const settlement = await tasks.begin(chat, 'settlement')
  const second = await runner.run({ sessionId: 'parent', task: 'settlement', persistent: true, selection,
    persistentSessionId: settlement.participantRequest.sessionId, onPersistentSessionReady: id => settlement.bindSession(id),
    messages: [], tools: [] })
  await settlement.commit({ participant: settlement.participant(second) })
  assert.equal(second.traceSessionId, first.traceSessionId)
  await ctx.sessions.flush(runner.requestSession(first.traceSessionId))
  await runner.dispose()
  runner = makeRunner()
  const third = await filter({ chat, userText: '恢复后筛选', candidates })
  assert.equal(third.traceSessionId, first.traceSessionId)
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.system.includes('固定背景：雨夜旅店')))
  assert.match(JSON.stringify(requests[2].messages), /首次筛选/)
  assert.match(JSON.stringify(requests[2].messages), /结算完成/)
  assert.deepEqual(third.selected, ['entry:0'])
  const descriptors = sessionEvents(runner.requestSession(first.traceSessionId)).filter(event => event.type === 'subagent/descriptor')
  assert.equal(descriptors.length, 1)
  assert.equal(descriptors[0].data.label, '酒馆后台 Agent')
  assert.equal(descriptors[0].data.mode, 'continuable')
})
