#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { classifyResponse, requestChecks, refusalPatterns } from './lib/refusal.mjs'
import { loadScenario, assertions, settledTurn } from './lib/scenario.mjs'
import { prepareRuntime, startRuntime, sourceRoot } from './lib/runtime.mjs'
import { openBrowser, openPlay, openCard, send } from './lib/browser.mjs'
import { createEvidence, nativeResult, saveJson } from './lib/evidence.mjs'

const { values, positionals } = parseArgs({ options: { 'runtime-home': { type: 'string' }, output: { type: 'string' }, headed: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: true })
if (values.help || positionals.length !== 1) {
  console.log('Usage: pnpm test:play SCENARIO.yaml [--runtime-home ~/.dsh-tavern] [--output DIRECTORY] [--headed]\n真实模型请求会计费。结果和独立存档默认保存在 testsets/results。')
  process.exitCode = values.help ? 0 : 2
} else await main().catch(error => { console.error(String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[URL]')); process.exitCode = 1 })

async function main() {
  const scenario = await loadScenario(positionals[0])
  const patterns = refusalPatterns(scenario.refusalPatterns)
  const parent = path.resolve(values.output || path.join(sourceRoot, 'testsets/results'))
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const runRoot = await mkdtemp(path.join(parent, 'run-'))
  const report = { name: scenario.name || path.basename(scenario.file), status: 'running', startedAt: new Date().toISOString(), model: scenario.model,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim()),
    agents: { foreground: 'not-covered', background: 'not-covered', image: 'not-covered', card: 'not-covered' }, steps: [] }
  const controller = new AbortController()
  const interrupt = () => controller.abort(new Error('测试已中断'))
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  let runtime, browser, page, evidence, chat, env, active
  const log = message => console.log(message)
  async function poll(label, check) {
    const deadline = Date.now() + scenario.timeoutMs
    let nextUpdate = Date.now() + 30000
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted()
      const result = await check()
      if (result) return result
      if (Date.now() >= nextUpdate) { log('等待：' + label); nextUpdate = Date.now() + 30000 }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(label + '超时')
  }
  function cover(role, status) { if (report.agents[role] !== 'failed') report.agents[role] = status }
  try {
    await saveJson(path.join(runRoot, 'scenario.json'), scenario)
    env = await prepareRuntime({ runRoot, runtimeHome: path.resolve(values['runtime-home'] || path.join(os.homedir(), '.dsh-tavern')), model: scenario.model,
      tavernSettings: scenario.tavernSettings || {}, images: scenario.steps.some(step => step.action === 'image') })
    evidence = createEvidence(env)
    runtime = await startRuntime({ ...env, runRoot, signal: controller.signal })
    ;({ browser, page } = await openBrowser(runtime.url, { headed: values.headed, timeoutMs: scenario.timeoutMs }))
    controller.signal.addEventListener('abort', () => { browser.close().catch(() => {}) }, { once: true })
    log('运行目录：' + runRoot)
    for (const [index, step] of scenario.steps.entries()) {
      controller.signal.throwIfAborted()
      active = { index: index + 1, action: step.action, status: 'running', startedAt: Date.now() }
      report.steps.push(active)
      const prefix = path.join(runRoot, String(index + 1).padStart(2, '0'))
      log(`步骤 ${index + 1}/${scenario.steps.length}：${step.action}`)
      let text = '', state = {}
      if (step.action === 'play' || step.action === 'card') {
        const before = new Set((await evidence.chats()).map(row => row.id))
        await (step.action === 'play' ? openPlay(page, step) : openCard(page, step))
        chat = await poll('创建对话', async () => {
          const found = (await evidence.chats()).filter(row => !before.has(row.id))
          if (found.length > 1) throw new Error('一次操作创建多个对话')
          return found.length && await evidence.chat(found[0].id)
        })
        if (step.action === 'play' && chat.requestMode === 'sillytavern') throw new Error('测试意外进入兼容模式')
        active.chatId = chat.id; active.sessionId = chat.sessionId
        state = chat
      } else if (step.action === 'say') {
        chat = await evidence.chat(chat.id)
        const role = chat.mode === 'card' ? 'card' : 'foreground'
        active.agent = role; active.input = step.input; active.chatId = chat.id; active.sessionId = chat.sessionId
        const events = await evidence.native(chat.sessionId)
        const afterSeq = events.reduce((seq, event) => Math.max(seq, Number(event.seq) || 0), 0)
        const beforeMessages = (chat.messages || []).length
        const previousRequests = new Set((await evidence.requests(chat.id)).map(r => r.id))
        const beforeResources = role === 'card' ? await evidence.resources() : {}
        await send(page, step.input)
        const result = await poll(role + '执行', async () => {
          const result = nativeResult(await evidence.native(chat.sessionId), afterSeq)
          if (!result.ready) return null
          if (result.error || result.reason?.kind !== 'completed') throw new Error(role + '未正常完成：' + (result.error || JSON.stringify(result.reason)))
          return result
        })
        cover(role, 'passed')
        await saveJson(prefix + '-native.json', result.events)
        if (role === 'foreground') {
          active.agent = 'background'
          const completed = await poll('后台结算落盘', async () => {
            const latest = await evidence.chat(chat.id)
            if (latest.foregroundError) throw new Error('正文执行失败')
            const progress = settledTurn(latest, beforeMessages, step.input)
            if (progress.error) throw new Error(String(progress.error))
            return progress.ready ? { chat: latest, reply: progress.reply } : null
          })
          chat = completed.chat; text = completed.reply.sourceText || completed.reply.text
          const backgroundRequests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id) && r.scope === 'background')
          cover('background', backgroundRequests.length ? 'passed' : 'not-invoked')
          for (const id of new Set(backgroundRequests.map(r => r.sessionId).filter(Boolean))) {
            await saveJson(prefix + '-background-native-' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json', await evidence.native(id))
          }
          active.replyTurn = completed.reply.turn
        } else {
          chat = await evidence.chat(chat.id); text = result.text
          const afterResources = await evidence.resources()
          active.changedResources = Object.keys(afterResources).filter(key => beforeResources[key]?.sha256 !== afterResources[key].sha256)
          active.deletedResources = Object.keys(beforeResources).filter(key => !afterResources[key])
          await saveJson(prefix + '-resources.json', { before: beforeResources, after: afterResources })
        }
        const requests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id))
        await saveJson(prefix + '-requests.json', requests)
        active.responseChecks = requestChecks(requests, chat.mode, patterns)
        active.response = { agent: role, ...classifyResponse({ text }, patterns) }
        active.requests = requests.map(r => ({ scope: r.scope, task: r.task, status: r.status, durationMs: r.durationMs, model: r.request?.model, sessionId: r.sessionId }))
        active.agent = role
        if (!text.trim()) throw new Error('Agent 未产生正文回复')
        state = chat
        await writeFile(prefix + '-reply.md', text, { mode: 0o600 })
      } else if (step.action === 'image') {
        active.agent = 'image'; active.chatId = chat.id
        chat = await evidence.chat(chat.id)
        const previousRequests = new Set((await evidence.requests(chat.id)).map(r => r.id))
        const before = await evidence.image(chat)
        if (before.record?.versions?.length) throw new Error('本轮已有图片；请在新的正文轮次生图')
        const button = page.getByRole('button', { name: '生图', exact: true })
        await button.waitFor()
        if (!await button.isEnabled()) throw new Error('生图未就绪：' + await button.getAttribute('title'))
        await button.click()
        const image = await poll('文生图 Agent 与图片保存', async () => {
          const { record } = await evidence.image(chat)
          if (record && ['failed', 'cancelled'].includes(record.status)) throw new Error(record.error || '生图失败')
          return record?.versions?.length ? record : null
        })
        await saveJson(prefix + '-image.json', image)
        const version = image.versions.at(-1)
        const url = new URL('/api/dsh-tavern/scene-image', runtime.url)
        url.search = new URLSearchParams({ sessionId: chat.sessionId, turn: String(before.target.turn), key: before.target.key, versionId: version.id }).toString()
        const response = await page.request.get(url.href)
        const bytes = await response.body()
        if (!response.ok() || !response.headers()['content-type']?.startsWith('image/') || !bytes.length) throw new Error('生成图片无法通过真实附件接口读取')
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[response.headers()['content-type'].split(';')[0]] || 'image'
        active.imageFile = path.basename(prefix) + '-image.' + extension
        await writeFile(path.join(runRoot, active.imageFile), bytes, { mode: 0o600 })
        const requests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id))
        await saveJson(prefix + '-requests.json', requests)
        active.requests = requests.map(r => ({ scope: r.scope, task: r.task, status: r.status, durationMs: r.durationMs, sessionId: r.sessionId }))
        for (const id of new Set(requests.map(r => r.sessionId).filter(Boolean))) await saveJson(prefix + '-image-native-' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json', await evidence.native(id))
        active.imageBytes = bytes.length; active.imageModel = version.model; active.versionId = version.id
        active.responseChecks = requestChecks(requests, chat.mode, patterns)
        active.response = { agent: 'image', ...classifyResponse({ text: '' }, patterns) }
        text = image.prompt || version.prompt || ''; state = image
        cover('image', 'passed')
      }
      active.assertions = assertions(step.expect, { text, state, changedFiles: (active.changedResources || []).map(file => file.split(path.sep).join('/')) })
      if (active.response) active.assertions.push({ check: 'refused', expected: step.expect?.refused ?? false, actual: active.response.refused, passed: active.response.refused === (step.expect?.refused ?? false) })
      const backgroundRefusals = (active.responseChecks || []).filter(check => check.agent === 'background' && check.refused === true)
      if (backgroundRefusals.length) active.assertions.push({ check: 'backgroundRefused', passed: false, evidence: backgroundRefusals })
      const assertionFailure = active.assertions.some(item => !item.passed)
      if (assertionFailure && active.agent) cover(backgroundRefusals.length ? 'background' : active.agent, 'failed')
      if (chat) await saveJson(prefix + '-chat.json', await evidence.chat(chat.id))
      await page.screenshot({ path: prefix + '.png', fullPage: true })
      active.status = assertionFailure ? 'failed' : 'passed'; active.durationMs = Date.now() - active.startedAt
      await saveJson(path.join(runRoot, 'report.json'), report)
      if (assertionFailure && !scenario.continueOnFailure) throw new Error('场景断言失败（包括模型拒绝预期）')
    }
    report.status = report.steps.some(step => step.status === 'failed') ? 'failed' : 'passed'
    if (report.status === 'failed') process.exitCode = 1
  } catch (error) {
    report.status = controller.signal.aborted ? 'interrupted' : 'failed'
    // Auth URLs must not reach reports or terminal output.
    report.error = String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[URL]')
    if (active) { active.status = 'failed'; active.durationMs = Date.now() - active.startedAt; if (active.agent) cover(active.agent, 'failed') }
    if (chat && evidence) {
      await saveJson(path.join(runRoot, 'failure-chat.json'), await evidence.chat(chat.id)).catch(() => {})
      const failedRequests = await evidence.requests(chat.id).catch(() => [])
      if (active) {
        active.responseChecks = requestChecks(failedRequests.filter(r => Number(r.createdAt) >= active.startedAt), chat.mode, patterns)
        active.response ||= active.responseChecks.find(check => check.agent === active.agent && check.refused) || (active.agent ? { agent: active.agent, ...classifyResponse({ error: report.error, completed: false }, patterns) } : undefined)
      }
      await saveJson(path.join(runRoot, 'failure-requests.json'), failedRequests).catch(() => {})
      await saveJson(path.join(runRoot, 'failure-native.json'), await evidence.native(chat.sessionId)).catch(() => {})
      if (active?.action === 'image') await saveJson(path.join(runRoot, 'failure-image.json'), await evidence.image(chat)).catch(() => {})
    }
    await page?.screenshot({ path: path.join(runRoot, 'failure.png'), fullPage: true }).catch(() => {})
    process.exitCode = 1
  } finally {
    await browser?.close().catch(() => {})
    await runtime?.stop()
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.finishedAt = new Date().toISOString()
    report.refusals = report.steps.flatMap(step => [...(step.response?.refused ? [{ step: step.index, ...step.response }] : []), ...(step.responseChecks || []).filter(check => check.refused).map(check => ({ step: step.index, ...check }))])
    await saveJson(path.join(runRoot, 'report.json'), report)
    const tableText = value => String(value || '').replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 100)
    const results = report.steps.flatMap(step => {
      const grouped = new Map()
      for (const check of [step.response, ...(step.responseChecks || [])].filter(Boolean)) {
        const old = grouped.get(check.agent)
        if (!old || check.refused || old.verdict === '通过' && check.verdict === '执行异常') grouped.set(check.agent, check)
      }
      return [...grouped].map(([agent, check]) => `| ${step.index} | ${agent} | ${tableText(step.input)} | ${check.verdict} | ${step.status} |`)
    }).join('\n')
    const refusalText = report.refusals.map(check => `- 步骤 ${check.step} / ${check.agent}：${check.evidence.replaceAll('\n', ' ').slice(0, 500)}`).join('\n')
    const rows = Object.entries(report.agents).map(([agent, status]) => `| ${agent} | ${status} |`).join('\n')
    await writeFile(path.join(runRoot, 'report.md'), `# ${report.name}\n\n结果：${report.status}\n\n| Agent | 结果 |\n|---|---|\n${rows}\n\n| 步骤 | Agent | 输入 | 响应判定 | 测试结果 |\n|---|---|---|---|---|\n${results}\n\n拒绝证据（规则识别，需结合原文复核）：\n\n${refusalText || '无'}\n\n${report.error || ''}\n\n每步证据位于同目录，真实存档位于 home/profile-data/tavern。\n`, { mode: 0o600 })
    log(`${report.status}：${path.join(runRoot, 'report.md')}`)
    if (report.error) log(report.error)
  }
}
