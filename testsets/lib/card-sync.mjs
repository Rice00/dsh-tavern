import { readFile, mkdir, realpath, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { files, json, saveJson } from './evidence.mjs'

const preparation = createCardPreparation()
export function validateSourceCard(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.json') || /[\\/\x00]/.test(filename) || filename === '.json') throw new Error('sourceCard 只能填写正式人物卡库中的 JSON 文件名')
}
export async function readSourceCard(runtimeHome, filename) {
  validateSourceCard(filename)
  const root = await realpath(path.join(runtimeHome, 'profile-data/tavern/data/resources/cards'))
  const source = await realpath(path.join(root, filename))
  if (!source.startsWith(root + path.sep)) throw new Error('来源人物卡不在正式人物卡库中')
  const bytes = await readFile(source)
  const document = JSON.parse(bytes.toString('utf8'))
  const exported = preparation.present({ card: document, as: 'sillytavern-v3' })
  const name = exported.data?.name
  if (typeof name !== 'string' || !name.trim()) throw new Error('来源人物卡没有有效名称')
  return { source, filename, bytes, name, sha256: createHash('sha256').update(bytes).digest('hex') }
}

// Copy the real workspace document before DSH starts; never modify the source library.
export async function syncSourceCards({ runtimeHome, home, dataRoot, filenames, runRoot }) {
  const targetRoot = path.join(dataRoot, 'resources/cards')
  await mkdir(targetRoot, { recursive: true })
  const targetReal = await realpath(targetRoot)
  const mappingFile = path.join(home, 'test-card-sources.json')
  const mapping = await json(mappingFile, {})
  const synced = []
  for (const filename of new Set(filenames)) {
    const card = await readSourceCard(runtimeHome, filename)
    if (card.source.startsWith(targetReal + path.sep)) throw new Error('正式卡库与测试卡库不能相同')
    let relative = mapping[filename]
    if (!relative) {
      const matching = []
      for (const file of await files(targetRoot)) {
        if (!file.endsWith('.json')) continue
        const document = await json(file)
        if (preparation.present({ card: document, as: 'sillytavern-v3' }).data?.name === card.name) matching.push(path.relative(targetRoot, file))
      }
      if (matching.length > 1) throw new Error('测试卡库存在多张同名卡，无法确定同步目标：' + card.name)
      relative = matching[0] || filename
    }
    if (Object.entries(mapping).some(([source, target]) => source !== filename && target === relative)) throw new Error('不同来源卡不能同步到同一个测试文件')
    const target = path.resolve(targetReal, relative)
    if (!target.startsWith(targetReal + path.sep)) throw new Error('测试人物卡目标路径无效')
    const parent = await realpath(path.dirname(target))
    if (parent !== targetReal && !parent.startsWith(targetReal + path.sep)) throw new Error('测试人物卡目标目录无效')
    if (target === card.source) throw new Error('不能覆盖正式人物卡')
    const before = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    const previousSha256 = before ? createHash('sha256').update(before).digest('hex') : null
    // Preserve the exact bytes for replay, including when the source changes during a later run.
    const snapshotFile = String(synced.length + 1).padStart(2, '0') + '-source-card.json'
    await writeFile(path.join(runRoot, snapshotFile), card.bytes, { mode: 0o600 })
    const temporary = target + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, card.bytes, { mode: 0o600 }); await rename(temporary, target) }
    finally { await rm(temporary, { force: true }) }
    mapping[filename] = relative
    await saveJson(mappingFile, mapping)
    synced.push({ filename, source: card.source, name: card.name, target: 'resources/cards/' + relative.split(path.sep).join('/'), sha256: card.sha256,
      previousSha256, changed: previousSha256 !== card.sha256, snapshotFile, syncedAt: new Date().toISOString() })
    await saveJson(path.join(runRoot, 'card-sync.json'), synced)
  }
  return synced
}
