import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { installCompactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'

test('retained plugin teardown callbacks do not keep released compaction engines alive', async () => {
  await promisify(execFile)(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/compaction-policy-retention.mjs', import.meta.url))], { timeout: 15000 })
})

test('live engines still route and restore their original method at teardown', async () => {
  const calls = []
  const original = async function (...args) { calls.push([this, ...args]); return 'native' }
  const engine = { compactIfNeeded: original }
  const dispose = installCompactionPolicy(engine, async (_agent, _trigger, _signal, fallback) => fallback())
  assert.equal(await engine.compactIfNeeded('agent', 'pressure', 'signal'), 'native')
  assert.deepEqual(calls, [[engine, 'agent', 'pressure', 'signal']])
  dispose(); dispose()
  assert.equal(engine.compactIfNeeded, original)
})

test('teardown does not overwrite a later policy installed by another owner', () => {
  const engine = { compactIfNeeded() {} }
  const dispose = installCompactionPolicy(engine, async () => null)
  const replacement = () => 'replacement'
  engine.compactIfNeeded = replacement
  dispose()
  assert.equal(engine.compactIfNeeded, replacement)
})
