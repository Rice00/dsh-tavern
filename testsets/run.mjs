#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { loadScenario } from '../bin/play-testing/scenario.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const name = args[0] && !args[0].startsWith('--') ? args.shift() : '001-duan-yingying-continue'
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('案例名称只能包含字母、数字、短横线与下划线')
const checkOnly = args.includes('--check')
const forwarded = args.filter(arg => arg !== '--check')
const folder = path.join(root, name)
const scenarioFile = path.join(folder, 'scenario.yaml')
try {
  const scenario = await loadScenario(scenarioFile)
  const source = JSON.parse(await readFile(path.join(folder, 'card.source.json'), 'utf8'))
  const card = await readFile(path.join(folder, 'card.json'))
  const digest = createHash('sha256').update(card).digest('hex')
  if (digest !== source.snapshotSha256) throw new Error('人物卡快照已变化，请核实并更新 card.source.json 中的快照哈希')
  console.log(`案例：${scenario.name}`)
  console.log(`模型：${scenario.model.provider} / ${scenario.model.model} / ${scenario.model.reasoningEffort}`)
  console.log(`人物卡 SHA-256：${digest}`)
  if (checkOnly) console.log('配置与人物卡快照检查通过；未调用模型。')
  else {
    const hasOutput = forwarded.some(arg => arg === '--output' || arg.startsWith('--output='))
    const child = spawn(process.execPath, [path.join(root, '../bin/test-play.mjs'), scenarioFile,
      ...(hasOutput ? [] : ['--output', path.join(root, 'results', name)]), ...forwarded], { stdio: 'inherit', shell: false })
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
    child.on('error', error => { console.error(error.message); process.exitCode = 1 })
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  }
} catch (error) {
  console.error(error.code === 'ENOENT' ? '案例或本地人物卡文件缺失；请检查 ' + folder : error.message)
  process.exitCode = 1
}
