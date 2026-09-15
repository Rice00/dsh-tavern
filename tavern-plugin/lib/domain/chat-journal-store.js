import { appendFile, mkdir, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { applyJsonChanges, applyJsonChangesShared, diffJson } from './json-mutation.js'

const STORAGE_REVISION = '_storageRevision'
const SNAPSHOT_PATTERN = /^(\d{12})\.json$/
const JOURNAL_PATTERN = /^(\d{12})-(open|(\d{12}))\.jsonl$/

function revisionOf(value) {
  return Math.max(0, Number(value && value[STORAGE_REVISION]) || 0)
}

function revisionName(value) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999999999999) throw new Error('Chat storage revision 超出范围: ' + String(value))
  return String(revision).padStart(12, '0')
}

function jsonClone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function encodeSnapshot(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function encodeFrame(value) {
  return JSON.stringify(value) + '\n'
}

function safeChatId(value) {
  const id = String(value || '')
  if (id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') throw new Error('Tavern Chat ID 不合法')
  return id
}

async function exists(target) {
  try { await stat(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function readJson(target) {
  try { return JSON.parse(await readFile(target, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}

/** Append-oriented JSON storage for one materialized Tavern Chat per directory. */
export function createChatJournalStore(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  const chatsRoot = path.join(dataRoot, 'chats')
  const legacyData = options.legacyData
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const frameLimit = Math.max(1, Number(options.frameLimit) || 200)
  const byteLimit = Math.max(1, Number(options.byteLimit) || 1024 * 1024)
  const mutationTails = new Map()
  let cachedRead
  if (String(options.dataRoot || '') === '') throw new Error('Chat Journal Store 缺少 dataRoot')

  function layout(chatId) {
    const id = safeChatId(chatId)
    const root = path.join(chatsRoot, id)
    return {
      id,
      root,
      snapshots: path.join(root, 'snapshots'),
      journals: path.join(root, 'journals'),
      legacy: path.join(chatsRoot, id + '.json'),
      legacyRelative: 'chats/' + id + '.json'
    }
  }

  function serialize(chatId, operation) {
    const id = safeChatId(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(operation)
    mutationTails.set(id, current)
    return current.finally(function () { if (mutationTails.get(id) === current) mutationTails.delete(id) })
  }

  async function legacyRead(paths) {
    if (legacyData && typeof legacyData.readJson === 'function') return await legacyData.readJson(paths.legacyRelative)
    return await readJson(paths.legacy)
  }

  async function snapshotRows(paths) {
    let names
    try { names = await readdir(paths.snapshots) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = SNAPSHOT_PATTERN.exec(name)
      return match === null ? null : { name, revision: Number(match[1]), path: path.join(paths.snapshots, name) }
    }).filter(Boolean).sort(function (left, right) { return left.revision - right.revision })
  }

  async function journalRows(paths) {
    let names
    try { names = await readdir(paths.journals) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = JOURNAL_PATTERN.exec(name)
      if (match === null) return null
      return {
        name,
        start: Number(match[1]),
        end: match[2] === 'open' ? Number.POSITIVE_INFINITY : Number(match[3]),
        open: match[2] === 'open',
        path: path.join(paths.journals, name)
      }
    }).filter(Boolean).sort(function (left, right) { return left.start - right.start || Number(left.open) - Number(right.open) })
  }

  async function parseJournal(row, afterRevision, targetRevision) {
    const text = await readFile(row.path, 'utf8')
    const lines = text.split('\n')
    const frames = []
    let validBytes = 0
    let invalidLine = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line === '') {
        validBytes += index < lines.length - 1 ? 1 : 0
        continue
      }
      let frame
      try { frame = JSON.parse(line) } catch (error) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal 尾行损坏，忽略该行及后续内容:', row.path + ':' + invalidLine, String(error?.message || error))
        break
      }
      validBytes += Buffer.byteLength(line + '\n')
      const revision = Number(frame && frame.revision)
      if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(frame.changes)) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal frame 不合法，忽略该行及后续内容:', row.path + ':' + invalidLine)
        break
      }
      if (revision > afterRevision && revision <= targetRevision) frames.push(frame)
    }
    return { frames, lineCount: frames.length, bytes: Buffer.byteLength(text), validBytes, invalidLine }
  }

  async function materializeDirectory(paths, targetRevision = Number.POSITIVE_INFINITY) {
    const snapshots = await snapshotRows(paths)
    const eligible = snapshots.filter(function (row) { return row.revision <= targetRevision })
    const selected = eligible[eligible.length - 1]
    if (selected === undefined) throw new Error('Chat Journal 缺少可用 snapshot: ' + paths.id)
    let chat = await readJson(selected.path)
    if (chat === undefined) throw new Error('Chat snapshot 不存在: ' + selected.path)
    let revision = selected.revision
    let open = null
    let openFrameCount = 0
    let openValidBytes = 0
    let openInvalidLine = 0
    const changes = []
    for (const row of await journalRows(paths)) {
      if (row.end <= revision || row.start > targetRevision) continue
      const parsed = await parseJournal(row, revision, targetRevision)
      for (const frame of parsed.frames) {
        if (Number(frame.baseRevision) !== revision || Number(frame.revision) !== revision + 1) {
          const error = new Error('Chat journal revision 不连续: ' + row.path + '，期望 ' + (revision + 1) + '，实际 ' + frame.revision)
          error.code = 'DSH_TAVERN_JOURNAL_GAP'
          throw error
        }
        if (!Array.isArray(frame.changes)) throw new Error('JSON mutation changes 必须是数组')
        for (const change of frame.changes) changes.push(change)
        revision = Number(frame.revision)
      }
      if (row.open) {
        open = row
        openFrameCount = parsed.frames.length
        openValidBytes = parsed.validBytes
        openInvalidLine = parsed.invalidLine
      }
    }
    if (targetRevision !== Number.POSITIVE_INFINITY && revision !== targetRevision) {
      const error = new Error('Chat Journal 找不到 revision ' + targetRevision + ': ' + paths.id)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    // Replay the ordered changes in one clone. Cloning the full card once per
    // journal frame makes initialization slower with every small script write.
    chat = applyJsonChanges(chat, changes)
    chat[STORAGE_REVISION] = revision
    return { chat, revision, snapshot: selected, open, openFrameCount, openValidBytes, openInvalidLine }
  }

  async function materialize(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    const paths = layout(chatId)
    if (await exists(paths.root)) return await materializeDirectory(paths, targetRevision)
    const chat = await legacyRead(paths)
    if (chat === undefined) return null
    const revision = revisionOf(chat)
    if (targetRevision !== Number.POSITIVE_INFINITY && targetRevision !== revision) {
      const error = new Error('Legacy Chat 只有 revision ' + revision + '，无法读取 revision ' + targetRevision)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    chat[STORAGE_REVISION] = revision
    return { chat: jsonClone(chat), revision, snapshot: null, open: null, openFrameCount: 0, legacy: true }
  }

  async function writeSnapshot(paths, chat, revision) {
    await mkdir(paths.snapshots, { recursive: true })
    const target = path.join(paths.snapshots, revisionName(revision) + '.json')
    try { await writeFile(target, encodeSnapshot(chat), { encoding: 'utf8', flag: 'wx' }) } catch (error) { if (error?.code !== 'EEXIST') throw error }
    return target
  }

  async function migrateLegacy(paths, current) {
    await mkdir(paths.journals, { recursive: true })
    await writeSnapshot(paths, current, revisionOf(current))
    if (!(await exists(paths.legacy)) && !(legacyData && typeof legacyData.remove === 'function')) return
    const backup = path.join(chatsRoot, paths.id + '.legacy-' + now() + '.json')
    await writeFile(backup, encodeSnapshot(current), { encoding: 'utf8', flag: 'wx' })
    if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
    else await rm(paths.legacy, { force: true })
  }

  async function appendFrame(paths, frame, currentOpen) {
    await mkdir(paths.journals, { recursive: true })
    const openPath = currentOpen === null
      ? path.join(paths.journals, revisionName(frame.revision) + '-open.jsonl')
      : currentOpen.path
    await appendFile(openPath, encodeFrame(frame), 'utf8')
    return { path: openPath, start: currentOpen === null ? frame.revision : currentOpen.start, open: true }
  }

  async function maybeRotate(paths, state, open, frameCount) {
    const info = await stat(open.path)
    if (frameCount < frameLimit && info.size < byteLimit) return false
    await writeSnapshot(paths, state.chat, state.revision)
    const sealed = path.join(paths.journals, revisionName(open.start) + '-' + revisionName(state.revision) + '.jsonl')
    await rename(open.path, sealed)
    return true
  }

  // Retain only the most recent materialization, verified against disk on every read.
  async function cachedState(chatId) {
    const stamp = await version(chatId)
    if (stamp && cachedRead?.id === chatId && cachedRead.stamp === stamp) return cachedRead.state
    const state = await materialize(chatId)
    if (stamp && stamp === await version(chatId)) cachedRead = state && {id:chatId,stamp,state}
    else if (cachedRead?.id === chatId) cachedRead = undefined
    return state
  }
  async function read(chatId) {
    const previous=cachedRead?.state
    const state=await cachedState(chatId)
    return state ? (state===previous?structuredClone(state.chat):jsonClone(state.chat)) : undefined
  }
  function slice(chat, indices) {
    const {messages:rawMessages,...head}=chat
    const messages=Array.isArray(rawMessages)?rawMessages:[]
    if(indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=messages.length))throw new Error('消息楼层不存在')
    return {chat:structuredClone({...head,messages:indices.map(i=>messages[i])}),messageCount:messages.length,denseMessages:Array.isArray(rawMessages) && messages.every(m=>m && typeof m==='object' && !Array.isArray(m))}
  }
  /** Detached metadata and selected native rows, never an editable full-chat snapshot. */
  async function readSlice(chatId, indices=[]) {
    const state=await cachedState(chatId)
    return state && !indices.some(i=>i>=(state.chat.messages?.length||0)) ? slice(state.chat,indices) : undefined
  }
  /** Exact-version internal commit; stale callers must use their existing merge path. */
  async function patch(chatId, expectedRevision, changes, metadata={}) {
    return serialize(chatId,async()=>{
      const state=await cachedState(chatId)
      if(!state || state.revision!==expectedRevision)return undefined
      const paths=layout(chatId)
      const next=applyJsonChangesShared(state.chat,changes)
      if(next.id!==chatId || revisionOf(next)!==expectedRevision+1)throw new Error('Invalid journal patch revision')
      if(state.legacy)await migrateLegacy(paths,state.chat)
      if(state.open && state.openInvalidLine>0)await truncate(state.open.path,state.openValidBytes)
      const frame={schemaVersion:1,chatId,baseRevision:expectedRevision,revision:expectedRevision+1,timestamp:now(),source:String(metadata.source||'unknown'),changes}
      if(metadata.requestId)frame.requestId=String(metadata.requestId)
      if(metadata.operationId)frame.operationId=String(metadata.operationId)
      metadata.assertCurrent?.()
      cachedRead=undefined
      const open=await appendFrame(paths,frame,state.open)
      const rotated=await maybeRotate(paths,{chat:next,revision:frame.revision},open,state.openFrameCount+1)
      if(!rotated)cachedRead={id:chatId,stamp:await version(chatId),state:{...state,chat:next,revision:frame.revision,legacy:false,open,openFrameCount:state.openFrameCount+1,openInvalidLine:0}}
      return slice(next,[]).chat
    })
  }

  async function readRevision(chatId, revision) {
    const target = Number(revision)
    if (!Number.isSafeInteger(target) || target < 0) throw new Error('Chat storage revision 不合法: ' + String(revision))
    const state = await materialize(chatId, target)
    return state === null ? undefined : jsonClone(state.chat)
  }

  async function update(chatId, updater, metadata = {}) {
    if (typeof updater !== 'function') throw new Error('Chat Journal Store 缺少 updater')
    return await serialize(chatId, async function () {
      const paths = layout(chatId)
      if (cachedRead?.id === chatId) cachedRead = undefined
      const currentState = await materialize(paths.id)
      const current = currentState === null ? undefined : jsonClone(currentState.chat)
      const produced = await updater(jsonClone(current))
      if (produced === undefined) return current
      const next = jsonClone(produced)
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('Chat Journal 只能保存 JSON object')
      if (currentState === null) {
        await mkdir(paths.journals, { recursive: true })
        await writeSnapshot(paths, next, revisionOf(next))
        return jsonClone(next)
      }
      const baseRevision = currentState.revision
      const revision = revisionOf(next)
      if (revision !== baseRevision + 1) throw new Error('Chat Journal 写入 revision 非连续，期望 ' + (baseRevision + 1) + '，实际 ' + revision)
      const changes = diffJson(current, next)
      if (changes.length === 0) return current
      if (currentState.legacy) await migrateLegacy(paths, current)
      if (currentState.open !== null && currentState.openInvalidLine > 0) {
        await truncate(currentState.open.path, currentState.openValidBytes)
      }
      const frame = {
        schemaVersion: 1,
        chatId: paths.id,
        baseRevision,
        revision,
        timestamp: now(),
        source: String(metadata.source || 'unknown'),
        changes
      }
      if (metadata.requestId) frame.requestId = String(metadata.requestId)
      if (metadata.operationId) frame.operationId = String(metadata.operationId)
      const open = await appendFrame(paths, frame, currentState.open)
      await maybeRotate(paths, { chat: next, revision }, open, currentState.openFrameCount + 1)
      return jsonClone(next)
    })
  }

  async function version(chatId) {
    const paths = layout(chatId)
    if (!(await exists(paths.root))) {
      if (legacyData && typeof legacyData.version === 'function') return await legacyData.version(paths.legacyRelative)
      try {
        const info = await stat(paths.legacy, { bigint: true })
        return ['legacy', info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    }
    const snapshots = await snapshotRows(paths)
    const journals = await journalRows(paths)
    const latestSnapshot = snapshots[snapshots.length - 1]
    const latestJournal = journals[journals.length - 1]
    if (latestSnapshot === undefined && latestJournal === undefined) return ''
    const relevant = journals.filter(row => row.end > (latestSnapshot?.revision || 0))
    const stamps = await Promise.all([...(latestSnapshot ? [latestSnapshot] : []), ...relevant].map(async row => {
      const info = await stat(row.path, { bigint: true })
      return [row.name,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')
    }))
    return ['journal', latestSnapshot?.name || '', ...stamps].join(':')
  }

  async function remove(chatId) {
    await serialize(chatId, async function () {
      const paths = layout(chatId)
      if (cachedRead?.id === chatId) cachedRead = undefined
      await rm(paths.root, { recursive: true, force: true })
      if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
      else await rm(paths.legacy, { force: true })
      let names
      try { names = await readdir(chatsRoot) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
      await Promise.all(names.filter(function (name) { return name.startsWith(paths.id + '.legacy-') && name.endsWith('.json') }).map(function (name) {
        return rm(path.join(chatsRoot, name), { force: true })
      }))
    })
  }

  return Object.freeze({ read, readSlice, patch, readRevision, update, version, remove })
}
