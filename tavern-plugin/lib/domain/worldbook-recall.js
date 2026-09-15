import { projectAgentContent } from './runtime-content-projection.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { activateWorldBook, promptOrder, placementKey, dynamicPlacementKeys } from './worldbook-activation.js'

const READ_COOLDOWN_TURNS = 10

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function charCount(value) {
  return Array.from(str(value).trim()).length
}

function fingerprint(value) {
  const text = str(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return text.length.toString(36) + ':' + (hash >>> 0).toString(36)
}

function enabledEntries(worldBook) {
  const view = worldBook && worldBook.view
  if (view === null || typeof view !== 'object') return []
  return (Array.isArray(view.entries) ? view.entries : []).filter(function (entry) {
    return entry && entry.enabled !== false && str(entry.content).trim() !== ''
  })
}

function allEntries(worldBook) {
  const view = worldBook && worldBook.view
  return view !== null && typeof view === 'object' && Array.isArray(view.entries) ? view.entries.filter(Boolean) : []
}

export function isWorldBookTemplateEntry(entry) {
  return /<%[=_-]?[\s\S]*?%>/i.test(str(entry && entry.content))
}

function templateBody(value) {
  const lines = str(value).replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length && /^@@\S*/.test(lines[index].trim())) index += 1
  return lines.slice(index).join('\n')
}

function templateResource(entry, book) {
  return {
    id: str(entry.sourceUid ?? entry.ref),
    name: str(entry.title || entry.comment),
    comment: str(entry.comment || entry.title),
    book: str(book),
    content: str(entry.content)
  }
}

function transcriptOf(chat) {
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).filter(Boolean).map(function (message) {
    return {
      role: message.role === 'user' ? 'user' : 'assistant',
      content: str(message.sourceText || message.text)
    }
  })
}

export function isMvuUpdateEntry(entry) {
  return /^\s*(?:\d+[a-z]?[_\s.-]*)?\[mvu_update\]/i.test(str(entry && (entry.comment || entry.title || entry.name)))
}

export function mvuUpdateRulesFromWorldBook(worldBook) {
  return enabledEntries(worldBook).filter(isMvuUpdateEntry).map(function (entry) {
    return str(entry.content).trim()
  })
}

function readRecord(chat, entry) {
  const reads = chat && chat.worldBookReads
  if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) return null
  const record = reads[str(entry && entry.ref)]
  return record !== null && typeof record === 'object' && !Array.isArray(record) ? record : null
}

function isCoolingDown(chat, entry, turn) {
  const record = readRecord(chat, entry)
  if (record === null || str(record.fingerprint) !== fingerprint(entry && entry.content)) return false
  const readTurn = Number(record.turn)
  const currentTurn = Number(turn)
  if (!Number.isSafeInteger(readTurn) || !Number.isSafeInteger(currentTurn)) return false
  const elapsed = currentTurn - readTurn
  return elapsed > 0 && elapsed <= READ_COOLDOWN_TURNS
}

function readRecorder(entries, turn) {
  return function recordReads(existing) {
    const next = clone(existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? existing : {})
    for (const entry of entries) {
      next[str(entry.ref)] = { turn: Number(turn) || 0, fingerprint: fingerprint(entry.content) }
    }
    return next
  }
}

/** Snapshot constant content; request projection partitions mixed positions separately. */
export function constantWorldBookContext(input = {}) {
  const entries = promptOrder(enabledEntries(input.worldBook).filter(function (entry) {
    return entry.constant === true && !isMvuUpdateEntry(entry) && !isWorldBookTemplateEntry(entry)
  }))
  return {
    context: entries.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: entries.map(function (entry) { return str(entry.ref) }),
    count: entries.length,
    totalChars: entries.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  }
}

/** Resolve enabled constant EJS controllers for one request.
 * includeConstants also projects plain entries and shares their macro state with
 * the caller, so constant setters can feed subsequently recalled entries.
 * Disabled entries remain addressable by getwi(), but never activate themselves.
 * Scope mutations stay inside this read-only projection and cannot change Chat state.
 */
export function projectWorldBookTemplates(input = {}) {
  const runtime = input.runtime
  if (!runtime || typeof runtime.render !== 'function') throw new Error('缺少世界书模板运行时')
  const resources = allEntries(input.worldBook)
  const controllers = promptOrder((input.selectedEntries || resources).filter(function (entry) {
    return entry.enabled !== false && (input.selectedEntries || entry.constant === true) && !isMvuUpdateEntry(entry) && (input.includeConstants === true || isWorldBookTemplateEntry(entry))
  }))
  const dynamicKeys = dynamicPlacementKeys(resources.filter(entry => !isMvuUpdateEntry(entry)))
  const projectedEntries = []
  let scopes = {
    global: clone(input.globalVariables || {}),
    initial: clone(input.chat && input.chat.promptTemplateInitialVariables || {}),
    local: clone(input.chat && input.chat.variables || {}),
    message: lastTavernHelperVariables(input.chat && input.chat.messages) || {}
  }
  let macroState = clone(input.chat?.macroState || {})
  const context = []
  const refs = []
  const diagnostics = []
  const templateContext = {
    charName: str(input.card && input.card.name),
    userName: str(input.chat && input.chat.macroState && input.chat.macroState.userName) || '你',
    runType: 'generate',
    generateType: str(input.generateType),
    transcript: transcriptOf(input.chat),
    worldBookEntries: resources.map(function (entry) {
      return templateResource(entry, input.worldBook && input.worldBook.view && input.worldBook.view.displayName)
    })
  }
  for (const entry of controllers) {
    const result = isWorldBookTemplateEntry(entry)
      ? runtime.render(templateBody(entry.content), Object.assign({}, templateContext, { scopes }))
      : { ok: true, text: entry.content, scopes }
    if (!result.ok) {
      diagnostics.push({ kind: 'worldbook-template', code: result.kind, ref: str(entry.ref) })
      continue
    }
    scopes = clone(result.scopes)
    const projected = input.includeConstants === true
      ? projectAgentContent(result.text, { charName: str(input.card?.name), macroState }) : null
    if (projected) macroState = projected.macroState
    const text = str(projected ? projected.agentText : result.text).trim()
    if (text === '') continue
    context.push(text)
    projectedEntries.push({ ...entry, content: text })
    refs.push(str(entry.ref))
  }
  return {
    context: context.join('\n\n'),
    renderedEntries: projectedEntries.map(entry => ({ ref: entry.ref, text: entry.content, location: dynamicKeys.has(placementKey(entry)) ? 'foreground' : 'prefix' })),
    prefixContext: projectedEntries.filter(entry => !dynamicKeys.has(placementKey(entry))).map(entry => entry.content).join('\n\n'),
    foregroundContext: projectedEntries.filter(entry => dynamicKeys.has(placementKey(entry))).map(entry => entry.content).join('\n\n'),
    refs,
    diagnostics,
    evaluated: controllers.length,
    ...(input.includeConstants === true ? { dynamicConstants: true, macroState } : {})
  }
}

/** Select at most five non-constant entries; retain the existing ten-turn cooldown. */
export function prepareWorldBookRecall(input = {}) {
  const all = enabledEntries(input.worldBook).filter(function (entry) { return !isMvuUpdateEntry(entry) })
  const emptyRecorder = readRecorder([], input.turn)
  if (!input.worldBook || !input.worldBook.view) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'unbound', recordReads: emptyRecorder }
  }
  if (all.length === 0) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'empty', recordReads: emptyRecorder }
  }
  const totalChars = all.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  const activation = activateWorldBook({ ...input, entries: all, isCoolingDown: entry => isCoolingDown(input.chat, entry, input.turn) })
  const selected = promptOrder(activation.entries.filter(entry => entry.constant !== true))
  return {
    kind: 'keywords',
    entries: activation.entries,
    diagnostics: activation.diagnostics,
    settings: activation.settings,
    scanSources: activation.scanSources,
    context: selected.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: selected.map(function (entry) { return str(entry.ref) }),
    totalChars,
    matchedCount: selected.length,
    recordReads: readRecorder(selected, input.turn)
  }
}
