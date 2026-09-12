import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { decodeZstdFrames } from '../session-prefix-migration.mjs'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { sceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'

export async function json(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
export async function files(root) {
  try { return (await readdir(root, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => path.join(e.parentPath || e.path, e.name)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
export function createEvidence({ home, dataRoot }) {
  const store = createChatJournalStore({ dataRoot })
  async function chats() {
    const index = await json(path.join(dataRoot, 'index.json'), {})
    return index.chats || []
  }
  async function native(sessionId) {
    const root = path.join(home, 'profile-data/tavern/sessions')
    const candidates = (await files(root)).filter(file => path.basename(path.dirname(file)) === sessionId && ['session.jsonl', 'session.jsonl.zstd'].includes(path.basename(file)))
    if (!candidates.length) return []
    if (candidates.length !== 1) throw new Error('Session 历史路径不唯一')
    const bytes = await readFile(candidates[0])
    const text = (candidates[0].endsWith('.zstd') ? decodeZstdFrames(bytes) : bytes).toString('utf8')
    return text.slice(0, text.lastIndexOf('\n')).split('\n').filter(Boolean).map(JSON.parse)
  }
  async function requests(chatId) {
    const root = path.join(dataRoot, 'model-requests', chatId)
    const index = await json(path.join(root, 'index.json'), {})
    return (await Promise.all((index.requests || []).map(item => json(path.join(root, item.id + '.json'))))).filter(Boolean)
  }
  async function image(chat) {
    const last = [...chat.messages].reverse().find(m => m.role === 'assistant')
    const target = sceneTarget(chat, Number(last.turn || (last.greeting ? 1 : 0)))
    const hash = createHash('sha256').update(chat.id).digest('hex')
    return { target, record: await json(path.join(dataRoot, 'scene-images', hash, target.key + '.json')) }
  }
  async function resources() {
    const result = {}
    for (const folder of ['cards', 'resources']) {
      for (const file of await files(path.join(dataRoot, folder))) {
        const content = await readFile(file)
        result[path.relative(dataRoot, file)] = { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
      }
    }
    return result
  }
  return { chats, chat: id => store.read(id), native, requests, image, resources }
}
export function nativeResult(events, afterSeq) {
  const added = events.filter(event => Number(event.seq) > afterSeq)
  const start = added.find(event => event.type === 'turn/start')
  if (!start) return { ready: false }
  const end = added.find(event => event.type === 'turn/end' && event.data?.turn === start.data?.turn)
  if (!end) return { ready: false }
  const messages = added.filter(event => event.type === 'assistant/message' && event.data?.turn === start.data.turn)
  const text = messages.flatMap(event => event.data?.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n')
  const errorEvent = added.find(event => /error|fail/.test(event.type))
  return { ready: true, turn: start.data.turn, reason: end.data.reason, text, error: errorEvent ? errorEvent.type : null, events: added }
}
export async function saveJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }) }
