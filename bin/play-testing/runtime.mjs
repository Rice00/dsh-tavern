import { mkdir, readFile, writeFile, copyFile, symlink, readdir, access, chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { parse, stringify } from 'yaml'
import { healthyCliRuntime } from '../cli-runtime.mjs'
import { resolveDshCliEntry } from '../plugin-dependencies.mjs'
import { webUrlFromLogChunk } from '../service-lifecycle.mjs'

export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function prepareRuntime({ runRoot, runtimeHome, model, tavernSettings = {}, images = false }) {
  const home = path.join(runRoot, 'home')
  const runtime = path.join(runtimeHome, 'runtime')
  if (!healthyCliRuntime(runtime)) throw new Error('需要已安装且版本匹配的 Tavern CLI runtime：' + runtime)
  const dependencies = path.join(runtimeHome, 'profiles/tavern/node_modules')
  await mkdir(home, { mode: 0o700 })
  const profile = path.join(home, 'profiles/tavern')
  await mkdir(profile, { recursive: true })
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(manifest, null, 2))
  await writeFile(path.join(profile, 'cordis.yml'), '[]\n')
  await copyFile(path.join(sourceRoot, 'cordis.patch.yml'), path.join(profile, 'cordis.patch.yml'))
  const modules = path.join(profile, 'node_modules')
  await mkdir(modules)
  for (const name of await readdir(dependencies)) {
    if (name.startsWith('.')) continue
    const specifier = manifest.dependencies?.[name]
    const target = specifier?.startsWith('link:') ? path.resolve(sourceRoot, specifier.slice(5)) : path.join(dependencies, name)
    await symlink(target, path.join(modules, name), 'junction')
  }
  const settings = parse(await readFile(path.join(runtimeHome, 'settings.yaml'), 'utf8')) || {}
  settings['agent-default-model'] = model
  await writeFile(path.join(home, 'settings.yaml'), stringify(settings), { mode: 0o600 })
  // Copy authentication only; never copy sessions, cards, attachments or user saves.
  for (const name of ['.credentials.yaml', '.openai-codex-auth.json']) {
    try { await access(path.join(runtimeHome, name)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    await copyFile(path.join(runtimeHome, name), path.join(home, name))
    await chmod(path.join(home, name), 0o600)
  }
  const dataRoot = path.join(home, 'profile-data/tavern/data')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(path.join(dataRoot, 'tavern-settings.json'), JSON.stringify(tavernSettings, null, 2))
  if (images) {
    await mkdir(path.join(dataRoot, 'scene-images'), { recursive: true })
    for (const name of ['settings.json', 'providers.json']) {
      await copyFile(path.join(runtimeHome, 'profile-data/tavern/data/scene-images', name), path.join(dataRoot, 'scene-images', name))
    }
    const file = path.join(dataRoot, 'scene-images/settings.json')
    const configured = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...configured, enabled: true }, null, 2))
  }
  return { home, dataRoot, runtime }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function startRuntime({ home, runtime, runRoot, signal }) {
  const port = await freePort()
  const command = path.join(runtime, process.platform === 'win32' ? 'dsh.cmd' : 'bin/dsh')
  const entry = resolveDshCliEntry({ dsh: command })
  const logFile = path.join(runRoot, 'runtime.log')
  const { open } = await import('node:fs/promises')
  const log = await open(logFile, 'a', 0o600)
  const child = spawn(process.execPath, [entry, '--profile', 'tavern', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: sourceRoot, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', log.fd, log.fd], windowsHide: true,
  })
  await log.close()
  let spawnError
  child.on('error', error => { spawnError = error })
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await pause(100)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  try {
    for (let i = 0; i < 120; i++) {
      signal?.throwIfAborted()
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error('DSH 启动失败，见 runtime.log')
      const url = webUrlFromLogChunk(await readFile(logFile, 'utf8'))
      if (url && new URL(url).origin === `http://127.0.0.1:${port}`) {
        try {
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
          await response.body?.cancel()
          if (response.status >= 200 && response.status < 400) return { url, port, stop }
        } catch {}
      }
      await pause(500)
    }
    throw new Error('DSH 启动超时，见 runtime.log')
  } catch (error) { await stop(); throw error }
}
