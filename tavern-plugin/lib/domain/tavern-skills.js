import { access, readFile, readdir, lstat, realpath, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from 'yaml'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

export const SKILL_AGENTS = ['card', 'foreground', 'background', 'image']
export function normalizeSkillAgents(value) {
  if (!Array.isArray(value) || value.some(role => !SKILL_AGENTS.includes(role))) throw new Error('Skill 用途必须是卡片、前台、后台或文生图 Agent')
  return [...new Set(value)]
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

export function normalizeTavernSkillName(value) {
  const name = str(value).trim().normalize('NFC')
  if (!SKILL_NAME.test(name) || name.length > 64) throw new Error('Skill 名称只允许小写字母、数字和连字符，且不能超过 64 个字符')
  return name
}

function renderSkill(input) {
  const description = str(input.description).trim()
  const body = str(input.body).trim()
  if (description === '') throw new Error('Skill 简介不能为空')
  if (description.length > 500) throw new Error('Skill 简介不能超过 500 个字符')
  if (body === '') throw new Error('Skill 正文不能为空')
  if (body.length > 100000) throw new Error('Skill 正文不能超过 100000 个字符')
  const frontmatter = [
    '---',
    'name: ' + input.name,
    'description: ' + JSON.stringify(description),
    ...(input.modelInvocable === false ? ['disable-model-invocation: true'] : []),
    ...(input.userInvocable === false ? ['user-invocable: false'] : []),
    'metadata:',
    '  tavern:',
    '    purpose: ' + JSON.stringify(input.purpose || 'card'),
    '---'
  ]
  return frontmatter.join('\n') + '\n\n' + body + '\n'
}

export function createTavernSkillModule(options = {}) {
  const directory = path.resolve(str(options.directory))
  const builtInDirectory = path.resolve(str(options.builtInDirectory))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  if (str(options.directory) === '' || str(options.builtInDirectory) === '') throw new Error('Tavern Skill Module 缺少目录')

  const roots = [{ kind: 'builtin', path: builtInDirectory, role: 'card' }, ...(options.backgroundDirectory ? [{ kind: 'builtin', path: path.resolve(options.backgroundDirectory), role: 'background' }] : []), { kind: 'user', path: directory, role: 'card' }]
  const listeners = new Set()
  const configPath = path.join(directory, '.assignments.json')
  let pending = Promise.resolve()
  function mutate(operation) {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result.then(value => { for (const listener of listeners) listener(); return value })
  }
  async function assignments() {
    try { return JSON.parse(await readFile(configPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }

  function target(root, name) {
    return path.join(root, normalizeTavernSkillName(name), 'SKILL.md')
  }

  async function read(name) {
    const normalized = normalizeTavernSkillName(name)
    for (const root of roots) {
      const source = { kind: root.kind, path: target(root.path, normalized) }
      try {
        if ((await lstat(path.dirname(source.path))).isSymbolicLink() || (await lstat(source.path)).isSymbolicLink()) throw new Error('Skill 入口不能是符号链接')
        const content = await readFile(source.path, 'utf8')
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
        const meta = match ? parse(match[1]) || {} : {}
        const purpose = meta.metadata?.tavern?.purpose || root.role
        const configuration = await assignments()
        const assigned = Object.hasOwn(configuration, normalized) ? configuration[normalized] : undefined
        if (assigned === null) return null
        const agents = assigned === undefined ? [purpose === 'writing' ? 'foreground' : purpose === 'background' ? 'background' : purpose === 'image' ? 'image' : root.role] : normalizeSkillAgents(assigned)
        return { name: normalized, source: source.kind, content, path: source.path, description: meta.description || '', purpose, agents, modelInvocable: meta['disable-model-invocation'] !== true, userInvocable: meta['user-invocable'] !== false }
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    return null
  }

  async function write(input = {}) {
    const name = normalizeTavernSkillName(input.name)
    if (await Promise.all(roots.filter(root => root.kind === 'builtin').map(root => exists(target(root.path, name)))).then(values => values.some(Boolean))) throw new Error('内置 Skill 不可覆盖: ' + name)
    const destination = target(directory, name)
    const present = await exists(destination)
    if (present && input.overwrite !== true) throw new Error('Skill 已存在；确认修改后请明确覆盖: ' + name)
    const previous = present ? await read(name) : null
    const content = renderSkill({
      name,
      purpose: input.purpose ?? previous?.purpose,
      description: input.description,
      body: input.body,
      modelInvocable: input.modelInvocable ?? previous?.modelInvocable,
      userInvocable: input.userInvocable ?? previous?.userInvocable
    })
    if (input.purpose !== undefined && !['card', 'writing', 'background', 'image'].includes(input.purpose)) throw new Error('未知 Skill 用途')
    const agents = input.agents === undefined ? undefined : normalizeSkillAgents(input.agents)
    const references = input.references ?? (present ? await referenceFiles(name) : [])
    if (!Array.isArray(references) || references.length > 30) throw new Error('Skill 最多附带 30 个参考文件')
    const seen = new Set()
    for (const ref of references) {
      validateReference(ref.path)
      if (seen.has(ref.path)) throw new Error('重复的参考文件')
      seen.add(ref.path)
      if (typeof ref.content !== 'string' || ref.content.length > 100000) throw new Error('参考文件正文不能超过 100000 个字符')
    }
    const bundle = path.dirname(destination)
    if (await exists(bundle) && (await lstat(bundle)).isSymbolicLink()) throw new Error('Skill 目录不能是符号链接')
    const staging = path.join(directory, '.stage-' + randomUUID())
    const backup = path.join(directory, '.backup-' + randomUUID())
    await mkdir(staging, { recursive: true })
    let moved = false
    try {
      await files.write(path.join(staging, 'SKILL.md'), content)
      for (const ref of references) await files.write(path.join(staging, ref.path), ref.content)
      if (await exists(bundle)) { await rename(bundle, backup); moved = true }
      try { await rename(staging, bundle) } catch (error) { if (moved) await rename(backup, bundle); throw error }
    } finally { await rm(staging, { recursive: true, force: true }) }
    if (moved) await rm(backup, { recursive: true, force: true })
    if (agents !== undefined) await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [name]: agents }))

    return { name, source: 'user', path: destination, content, chars: content.length, overwritten: present }
  }

  async function list() {
    const names = new Set()
    for (const root of roots) {
      let entries
      try { entries = await readdir(root.path, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      for (const entry of entries) if (entry.isDirectory() && SKILL_NAME.test(entry.name)) names.add(entry.name)
    }
    const result = []
    for (const name of [...names].sort()) { const skill = await read(name); if (skill) result.push(skill) }
    return result
  }
  function validateReference(relative) {
    if (typeof relative !== 'string' || !/^references\/[a-zA-Z0-9_./-]+\.md$/.test(relative) || relative.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('参考文件必须位于 references/ 内，使用相对 Markdown 路径')
  }
  async function readReference(name, relative) {
    validateReference(relative)
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    const base = await realpath(path.dirname(skill.path))
    const resolved = await realpath(path.join(base, relative))
    if (!resolved.startsWith(base + path.sep)) throw new Error('参考文件不能指向 Skill 目录之外')
    return await readFile(resolved, 'utf8')
  }
  async function referenceFiles(name) {
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    let entries
    try { entries = await readdir(path.join(path.dirname(skill.path), 'references'), { recursive: true, withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const result = []
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const relative = path.relative(path.dirname(skill.path), path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      validateReference(relative)
      result.push({ path: relative, content: await readReference(name, relative) })
    }
    return result
  }
  async function assign(name, agents) {
    const normalized = normalizeTavernSkillName(name)
    const roles = normalizeSkillAgents(agents)
    if (!await read(normalized)) throw new Error('Skill 不存在')
    await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [normalized]: roles }))
    return await read(normalized)
  }
  async function remove(name) {
    const skill = await read(name)
    if (!skill) throw new Error('Skill 不存在')
    if (skill.source === 'builtin') {
      await files.update(configPath, raw => JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), [skill.name]: null }))
      return
    }
    await rm(path.dirname(skill.path), { recursive: true })
    await files.update(configPath, raw => { const data = raw ? JSON.parse(raw) : {}; delete data[skill.name]; return JSON.stringify(data) })
  }
  return Object.freeze({ read, list, readReference, referenceFiles, write: input => mutate(() => write(input)), assign: (name, agents) => mutate(() => assign(name, agents)), remove: name => mutate(() => remove(name)), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } })
}
