import { stat } from 'node:fs/promises'

// Observational only: never resume, inspect/load logs, or materialize Chat histories.
export function createSessionInventory({ persistence, sessions, agents, references, archived, fileStat = stat, memory = () => process.memoryUsage(), now = Date.now }) {
  let inFlight
  async function collect() {
    const [headers, links] = await Promise.all([persistence.list(), references()])
    const storedIds = new Set(headers.map(header => header.id))
    const bySession = new Map()
    for (const link of links) {
      const refs = bySession.get(link.sessionId) || []
      refs.push({ chatId: link.chatId, title: link.title || link.cardName, lastOpenedAt: link.lastOpenedAt || null })
      bySession.set(link.sessionId, refs)
    }
    const live = new Map((sessions.list?.() || []).map(session => [session.id, session]))
    const metas = new Map(headers.map(header => [header.id, header]))
    for (const [id, session] of live) if (!metas.has(id)) metas.set(id, session.header || { id })
    for (const link of links) if (!metas.has(link.sessionId)) metas.set(link.sessionId, { id: link.sessionId })
    const archiveList = archived?.()
    const archivedIds = archiveList ? new Set(archiveList) : null
    const rows = []
    for (const [id, meta] of metas) {
      const agent = agents.get(id)
      const session = live.get(id) || sessions.get(id) || agent?.session
      const refs = bySession.get(id) || []
      let diskBytes = null, fileModifiedAt = null, storageError = null
      if (storedIds.has(id)) {
        try {
          const artifact = persistence.locate?.(meta)
          if (artifact?.path) {
            const info = await fileStat(artifact.path)
            diskBytes = info.size
            fileModifiedAt = info.mtimeMs
          }
        } catch (error) { storageError = error.code === 'ENOENT' ? '文件已不存在' : '文件属性读取失败' }
      }
      rows.push({ sessionId: id, loaded: Boolean(session), running: agent?.phase?.kind === 'running',
        archived: archivedIds ? archivedIds.has(id) : null, eventCount: Number.isSafeInteger(session?.seq) ? session.seq : null,
        diskBytes, fileModifiedAt, references: refs, storageError })
    }
    rows.sort((a, b) => Number(b.loaded) - Number(a.loaded) || (b.diskBytes || 0) - (a.diskBytes || 0) || a.sessionId.localeCompare(b.sessionId))
    const usage = memory()
    return { capturedAt: now(), rows, memory: { rss: usage.rss, heapUsed: usage.heapUsed },
      totals: { sessions: rows.length, loaded: rows.filter(row => row.loaded).length, archived: rows.filter(row => row.archived).length,
        knownDiskBytes: rows.reduce((sum, row) => sum + (row.diskBytes || 0), 0), unknownDiskSize: rows.filter(row => row.diskBytes === null).length } }
  }
  return { read() {
    if (!inFlight) inFlight = collect().finally(() => { inFlight = null })
    return inFlight
  } }
}
