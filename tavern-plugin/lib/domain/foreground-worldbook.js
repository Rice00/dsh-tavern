import { prepareWorldBookRecall, projectWorldBookTemplates } from './worldbook-recall.js'

/** One request uses one bound-book snapshot for both selection and rendering. */
export function createForegroundWorldbook({ bound, runtime, globalVariables, scanText = () => '' }) {
  return async function project({ chat, card, userText, userTextInHistory = false, worldBook: snapshot }) {
    try {
      const worldBook = snapshot || await bound(chat.cardPath, card, chat)
      const turn = Number([...(chat.messages || [])].reverse().find(message => message.role === 'assistant')?.turn) || 0
      // Older versions recorded the next-turn preview as a read. Let the first
      // real request re-evaluate that preview without suppressing its entries.
      const reads = { ...chat.worldBookReads }
      if (chat.preparedWorldBook && chat.preparedWorldBook.schemaVersion !== 2) {
        for (const ref of chat.preparedWorldBook.refs || []) {
          if (Number(reads[ref]?.turn) === Number(chat.preparedWorldBook.turn)) delete reads[ref]
        }
      }
      const recalled = prepareWorldBookRecall({ worldBook, chat: { ...chat, worldBookReads: reads }, card, turn, userText, userTextInHistory, scanText: scanText(chat) })
      const projected = projectWorldBookTemplates({ worldBook, selectedEntries: recalled.entries || [], includeConstants: true,
        runtime: await runtime(), globalVariables: await globalVariables(), chat, card })
      // A failed/empty template was not injected and must not consume cooldown.
      const renderedRefs = new Set(projected.refs)
      const accepted = recalled.refs.filter(ref => renderedRefs.has(ref))
      const recorded = recalled.recordReads(chat.worldBookReads)
      const nextReads = { ...chat.worldBookReads }
      for (const ref of accepted) nextReads[ref] = recorded[ref]
      return { ...projected, context: projected.foregroundContext, refs: accepted, reads: nextReads,
        activation: { schemaVersion: 2, turn, refs: accepted, diagnostics: recalled.diagnostics || [], mode: recalled.kind }, error: null }
    } catch (error) {
      return { context: '', refs: [], diagnostics: [], activation: { schemaVersion: 2, refs: [], mode: 'error' }, error: String(error?.message || error) }
    }
  }
}
