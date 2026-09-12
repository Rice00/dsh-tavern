import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReportServer } from '../report-ui.mjs'

test('report viewer lists nested results and exposes evidence without serving credentials or escaped paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-viewer-'))
  const results = path.join(root, 'results'), run = path.join(results, 'case/run-test')
  await mkdir(run, { recursive: true })
  await writeFile(path.join(run, 'report.json'), JSON.stringify({ name: '<script>bad()</script>', status: 'failed', steps: [{ action: 'say' }] }))
  await writeFile(path.join(run, '02-requests.json'), '[]')
  await writeFile(path.join(run, 'runtime.log'), 'private auth URL')
  await writeFile(path.join(root, 'secret.json'), 'secret')
  await symlink(path.join(root, 'secret.json'), path.join(run, 'failure-secret.json'))
  const server = await createReportServer(results)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const runs = await (await fetch(base + '/api/runs')).json()
    assert.equal(runs.length, 1); assert.equal(runs[0].rounds, 1)
    const id = runs[0].id
    const detail = await (await fetch(base + '/api/run?id=' + id)).json()
    assert.deepEqual(detail.files.map(f => f.name), ['02-requests.json', 'report.json'])
    assert.equal(await (await fetch(base + '/api/file?' + new URLSearchParams({ id, name: '02-requests.json' }))).text(), '[]')
    for (const name of ['runtime.log', '../secret.json', 'failure-secret.json']) assert.equal((await fetch(base + '/api/file?' + new URLSearchParams({ id, name }))).status, 404)
    const escaped = Buffer.from('../').toString('base64url')
    assert.equal((await fetch(base + '/api/run?id=' + escaped)).status, 404)
    assert.equal((await fetch(base + '/api/runs', { headers: { Origin: 'https://example.com' } })).status, 403)
    const invalidHost = await new Promise((resolve, reject) => { http.get(base + '/api/runs', { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode) }).on('error', reject) })
    assert.equal(invalidHost, 403)
    assert.equal((await fetch(base + '/api/runs', { method: 'POST' })).status, 405)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
