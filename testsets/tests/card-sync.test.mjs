import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { syncSourceCards, validateSourceCard } from '../lib/card-sync.mjs'

test('source sync replaces the existing test card, tracks edits and preserves prior run snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-card-sync-'))
  const runtimeHome = path.join(root, 'official'), home = path.join(root, 'test'), dataRoot = path.join(home, 'profile-data/tavern/data')
  const official = path.join(runtimeHome, 'profile-data/tavern/data/resources/cards'), target = path.join(dataRoot, 'resources/cards')
  const run1 = path.join(root, 'run1'), run2 = path.join(root, 'run2')
  await Promise.all([official, target, run1, run2].map(p => mkdir(p, { recursive: true })))
  const prep = createCardPreparation()
  const doc = text => JSON.stringify(prep.create({ kind: 'import', payload: { name: 'Demo', description: text } }))
  const source = path.join(official, 'source.json'), existing = path.join(target, 'old-import.json')
  const first = doc('version one')
  await writeFile(source, first); await writeFile(existing, doc('outdated test edit'))
  try {
    const a = await syncSourceCards({ runtimeHome, home, dataRoot, runRoot: run1, filenames: ['source.json'] })
    assert.equal(a[0].target, 'resources/cards/old-import.json')
    assert.equal(await readFile(existing, 'utf8'), first)
    assert.equal(await readFile(source, 'utf8'), first)
    const secondDoc = JSON.parse(doc('version two')); secondDoc.raw.name = 'Renamed'
    const second = JSON.stringify(secondDoc); await writeFile(source, second)
    const b = await syncSourceCards({ runtimeHome, home, dataRoot, runRoot: run2, filenames: ['source.json'] })
    assert.equal(b[0].target, a[0].target)
    assert.equal(b[0].name, 'Renamed')
    assert.notEqual(b[0].sha256, a[0].sha256)
    assert.equal(await readFile(existing, 'utf8'), second)
    assert.equal(await readFile(path.join(run1, a[0].snapshotFile), 'utf8'), first)
    await assert.rejects(syncSourceCards({ runtimeHome, home, dataRoot, runRoot: run2, filenames: ['missing.json'] }))
    assert.equal(await readFile(existing, 'utf8'), second)
    assert.throws(() => validateSourceCard('../source.json'))
    assert.throws(() => validateSourceCard('..\\source.json'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
