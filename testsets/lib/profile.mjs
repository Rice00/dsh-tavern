import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Stable per scenario; never point this at the player's installed Profile.
export async function acquireProfile(root, scenarioFile) {
  const id = createHash('sha256').update(path.resolve(scenarioFile)).digest('hex').slice(0, 16)
  const directory = path.join(root, id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, 'run.lock')
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, scenarioFile }), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`测试 Profile 已锁定：${lock}；若上次进程异常退出，请确认 DSH 子进程也已退出后删除锁文件`)
    throw error
  }
  return { home: path.join(directory, 'home'), release: () => rm(lock) }
}

export async function existingCardNames(dataRoot) {
  const { files } = await import('./evidence.mjs')
  const names = []
  for (const file of await files(path.join(dataRoot, 'resources/cards'))) {
    if (!file.endsWith('.json')) continue
    const card = JSON.parse(await readFile(file, 'utf8'))
    names.push(card.raw?.data?.name || card.raw?.name || card.data?.name || card.name)
  }
  return names.filter(Boolean)
}
