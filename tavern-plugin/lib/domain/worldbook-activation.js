// Selection priority and prompt order are different in SillyTavern.
const str = value => value == null ? '' : String(value)
export const DYNAMIC_ENTRY_LIMIT = 5
export function priorityOrder(entries) {
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
    (Number(b.entry.order ?? 100) - Number(a.entry.order ?? 100)) ||
    (Number(a.entry.displayIndex ?? a.index) - Number(b.entry.displayIndex ?? b.index)) || a.index - b.index
  ).map(item => item.entry)
}
export function promptOrder(entries) {
  const buckets = new Map()
  for (const entry of priorityOrder(entries)) {
    const key = placementKey(entry)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).unshift(entry)
  }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).flatMap(([, entries]) => entries)
}

// Preserve author-defined position boundaries without pretending to implement
// all ST message/depth anchors in the DSH adapter.
export function placementKey(entry) {
  const position = entry.position === 'before_char' ? 0 : entry.position === 'after_char' ? 1 : Number(entry.position ?? 0)
  return position === 4 ? `4:${entry.depth ?? 4}:${entry.role ?? 0}` : String(position)
}
export function dynamicPlacementKeys(entries) {
  return new Set(entries.filter(entry => entry.enabled !== false && (entry.constant !== true || entry.group)).map(placementKey))
}
function integer(value, fallback, max = 1000) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Math.min(max, Math.trunc(Number(value))))
}
export function worldBookSettings(worldBook) {
  const raw = worldBook?.view?.raw || {}
  return {
    scanDepth: integer(raw.scan_depth, 2),
    recursive: raw.recursive_scanning === true,
    caseSensitive: raw.case_sensitive === true,
    matchWholeWords: raw.match_whole_words === true
  }
}

function regexKey(value) {
  const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(str(value))
  if (!match) return null
  try {
    return new RegExp(match[1], match[2].replaceAll('g', '').replaceAll('y', ''))
  } catch (_error) {
    return null
  }
}

function literalMatch(text, key, entry) {
  const sensitive = entry.caseSensitive === true
  const source = sensitive ? text : text.toLocaleLowerCase()
  const needle = sensitive ? key : key.toLocaleLowerCase()
  if (needle === '') return false
  if (entry.matchWholeWords !== true || needle.split(/\s+/).length > 1) return source.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(?:^|\\W)' + escaped + '(?:$|\\W)').test(source)
  } catch (_error) {
    return source.includes(needle)
  }
}

function keyMatch(text, value, entry) {
  const key = str(value).trim()
  if (key === '') return false
  const regex = regexKey(key)
  if (regex !== null) return regex.test(text)
  return literalMatch(text, key, entry)
}

function keywordMatch(entry, body) {
  const primary = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []).filter(function (key) { return str(key).trim() !== '' })
  if (primary.length === 0 || !primary.some(function (key) { return keyMatch(body, key, entry) })) return false
  const secondary = (Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []).filter(function (key) { return str(key).trim() !== '' })
  if (entry.selective !== true || secondary.length === 0) return true
  const matches = secondary.map(function (key) { return keyMatch(body, key, entry) })
  switch (Number(entry.selectiveLogic) || 0) {
    case 1: return !matches.every(Boolean)
    case 2: return !matches.some(Boolean)
    case 3: return matches.every(Boolean)
    default: return matches.some(Boolean)
  }
}


function scanMessages(input) {
  const messages = (input.chat?.messages || []).filter(message => ['user', 'assistant'].includes(message?.role))
    .map(message => str(message.sourceText || message.text))
  // latestBody is retained for callers importing history or supplying a scan fixture.
  if (input.latestBody !== undefined) {
    const last = messages.length - 1
    if (last >= 0 && input.chat?.messages?.at(-1)?.role === 'assistant') messages[last] = str(input.latestBody)
    else messages.push(str(input.latestBody))
  }
  if (!input.userTextInHistory && str(input.userText).trim()) messages.push(str(input.userText))
  return messages.reverse()
}
function groupNames(entry) { return str(entry.group).split(/,\s*/).map(value => value.trim()).filter(Boolean) }
function option(entry, key, fallback) { return entry[key] ?? entry.rawEntry?.[key] ?? fallback }
function groupScore(entry, text) {
  const hits = keys => (keys || []).filter(key => keyMatch(text, key, entry)).length
  const primary = hits(entry.primaryKeys)
  const secondary = hits(entry.secondaryKeys)
  if (!(entry.primaryKeys || []).length) return 0
  // ST only counts positive secondary conditions; AND_ALL adds them only when all match.
  const logic = Number(entry.selectiveLogic) || 0
  return primary + (logic === 0 || (logic === 3 && secondary === (entry.secondaryKeys || []).length) ? secondary : 0)
}
function filterGroups(candidates, activated, textFor, random, reject) {
  const groups = new Map()
  for (const entry of candidates) for (const name of groupNames(entry)) {
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(entry)
  }
  const retained = new Set(candidates)
  const occupied = new Set(activated.flatMap(groupNames))
  for (const [name, members] of groups) {
    let pool = members.filter(entry => retained.has(entry))
    const remove = entry => { retained.delete(entry); reject(entry, 'group', { group: name }) }
    if (occupied.has(name)) { pool.forEach(remove); continue }
    if (pool.length < 2) continue
    if (pool.some(entry => option(entry, 'useGroupScoring', false))) {
      const scores = pool.map(entry => groupScore(entry, textFor(entry)))
      const max = Math.max(...scores)
      pool = pool.filter((entry, index) => {
        if (option(entry, 'useGroupScoring', false) && scores[index] < max) { remove(entry); return false }
        return true
      })
    }
    const overrides = priorityOrder(pool.filter(entry => option(entry, 'groupOverride', false)))
    let winner = overrides[0]
    if (!winner) {
      const weight = entry => Math.max(0, Number(option(entry, 'groupWeight', 100)) || 0)
      let roll = random() * pool.reduce((sum, entry) => sum + weight(entry), 0)
      winner = pool.find(entry => { roll -= weight(entry); return roll < 0 }) || pool[0]
    }
    for (const entry of pool) if (entry !== winner) remove(entry)
  }
  return candidates.filter(entry => retained.has(entry))
}

/** ST-style bounded history, keyword conditions, inclusion groups and recursion.
 * No model-based search, no full-text lookup of inactive entries. Timed effects
 * deliberately remain owned by the existing DSH ten-turn cooldown.
 */
export function activateWorldBook(input) {
  const settings = worldBookSettings(input.worldBook)
  const messages = scanMessages(input)
  const injected = str(input.scanText)
  const random = input.random || Math.random
  const entries = priorityOrder(input.entries).map(entry => ({ ...entry,
    caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords
  }))
  const activated = [], recurse = [], diagnostics = new Map(), rejected = new Set()
  const reject = (entry, reason, extra = {}) => diagnostics.set(entry.ref, { ref: entry.ref, reason, ...extra })
  const levels = [...new Set(entries.map(entry => integer(entry.delayUntilRecursion, 0)).filter(Boolean))].sort((a, b) => a - b)
  let level = 0, iteration = 0, dynamicCount = 0
  // Each successful step consumes entries; delayed levels are finite as well.
  while (iteration <= entries.length + levels.length + 1) {
    const textFor = entry => {
      const depth = integer(entry.scanDepth, settings.scanDepth)
      if (!depth) return ''
      return [...messages.slice(0, depth), injected, ...(iteration > 0 ? recurse : [])].filter(Boolean).join('\n\x01\n')
    }
    const candidates = []
    for (const entry of entries) {
      if (rejected.has(entry.ref) || activated.some(item => item.ref === entry.ref)) continue
      if (!entry.constant && input.isCoolingDown(entry)) { reject(entry, 'cooldown'); continue }
      const delay = integer(entry.delayUntilRecursion, 0)
      if (delay && (!iteration || delay > level)) { reject(entry, 'recursion-delay'); continue }
      if (iteration && entry.excludeRecursion) { reject(entry, 'recursion-excluded'); continue }
      if (!entry.constant && !keywordMatch(entry, textFor(entry))) { reject(entry, 'keywords'); continue }
      candidates.push(entry)
    }
    const winners = filterGroups(candidates, activated, textFor, random, (entry, reason, extra) => {
      reject(entry, reason, extra)
      rejected.add(entry.ref)
    })
    const added = []
    for (const entry of winners) {
      if (!entry.constant && dynamicCount >= DYNAMIC_ENTRY_LIMIT) { reject(entry, 'limit', { limit: DYNAMIC_ENTRY_LIMIT }); rejected.add(entry.ref); continue }
      activated.push(entry)
      added.push(entry)
      if (!entry.constant) dynamicCount++
      reject(entry, 'selected', { stage: iteration ? 'recursion' : 'initial', scanDepth: integer(entry.scanDepth, settings.scanDepth) })
    }
    if (!settings.recursive) break
    const sources = added.filter(entry => !entry.preventRecursion).map(entry => str(entry.content)).filter(Boolean)
    recurse.push(...sources)
    iteration++
    if (sources.length) continue
    const nextLevel = levels.find(value => value > level)
    if (nextLevel === undefined) break
    level = nextLevel
  }
  return { entries: activated, diagnostics: [...diagnostics.values()] }
}
