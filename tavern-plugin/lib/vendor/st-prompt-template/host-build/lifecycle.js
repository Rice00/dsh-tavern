import { eventSource, chat, getCurrentChatId, saveChatConditional, chat_metadata, extension_settings } from './host.js'
import { mountTemplateMessages, captureTemplateDisplay } from './dom.js'
import { settings } from '../upstream/src/modules/ui.ts'

const copy = value => structuredClone(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Detect changes in authoritative snapshots, never maintain a second chat history. */
export function createTemplateLifecycle() {
  let previous, worlds, features, definition, scopes, regexes
  return async function synchronize(snapshot) {
    if (snapshot.dsh?.settling) return { deferred: true }
    const currentScopes = {local:chat_metadata.variables,global:extension_settings.variables?.global}
    const currentRegexes = {card:snapshot.dsh?.regexScripts,temporary:extension_settings.regex}
    const changedScopes = !same(scopes,currentScopes)
    const changedRegexes = !same(regexes,currentRegexes)
    const currentDefinition = {characters:snapshot.characters,name1:snapshot.name1,name2:snapshot.name2}
    const changedDefinition = !same(definition,currentDefinition)
    if (!changedScopes && !changedRegexes && !changedDefinition && previous && same(previous, chat) && same(worlds, snapshot.worldbooks) && same(features, snapshot.extension_settings.EjsTemplate)) return { synchronized: false }
    document.getElementById('chat')?.replaceChildren()
    const changedWorlds = !same(worlds, snapshot.worldbooks)
    const changedSettings = !same(features, snapshot.extension_settings.EjsTemplate)
    if (changedSettings) await eventSource.emit('SETTINGS_LOADED')
    if (!previous || changedWorlds || changedSettings || changedDefinition) {
      await eventSource.emit('CHAT_CHANGED', getCurrentChatId())
      if (previous && changedWorlds) for (const [name, book] of Object.entries(snapshot.worldbooks || {})) await eventSource.emit('WORLDINFO_UPDATED', name, book)
    }
    const changedDepth = previous && previous.length !== chat.length
    mountTemplateMessages()
    if (previous && chat.length < previous.length) await eventSource.emit('MESSAGE_DELETED', chat.length)
    for (let index = 0; index < chat.length; index++) {
      const message = chat[index], old = previous?.[index]
      const swipe = message.swipe_id || 0
      const sourceChanged = !old || old.mes !== message.mes || old.swipe_id !== swipe
      const variablesChanged = !old || !same(old.variables, message.variables)
      if (!sourceChanged && !variablesChanged && !changedWorlds && !changedSettings && !changedDefinition && !changedScopes && !changedRegexes && !changedDepth) continue
      if (!old && previous) await eventSource.emit(message.is_user ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED', index)
      else if (old && old.swipe_id !== swipe) await eventSource.emit('MESSAGE_SWIPED', index)
      else if (old && old.mes !== message.mes) {
        message.is_ejs_processed ||= []; message.is_ejs_processed[swipe] = false
        await eventSource.emit('MESSAGE_EDITED', index)
      }
      if (old && (old.swipes?.length || 0) > (message.swipes?.length || 0)) await eventSource.emit('MESSAGE_SWIPE_DELETED', index, old.swipes.findIndex((text, i) => text !== message.swipes[i]))
      if (!old || old.swipe_id === swipe) await eventSource.emit(message.is_user ? 'USER_MESSAGE_RENDERED' : 'CHARACTER_MESSAGE_RENDERED', String(index), 'template-host', !sourceChanged || (!old && Boolean(message.is_ejs_processed?.[swipe])))
      if (settings.enabled && settings.render_enabled) {
        const display = captureTemplateDisplay(message,index)
        if (display) message.template_display = display
        else delete message.template_display
      } else delete message.template_display
    }
    await saveChatConditional()
    scopes = copy({local:chat_metadata.variables,global:extension_settings.variables?.global}); regexes = copy(currentRegexes)
    definition = copy(currentDefinition); previous = copy(chat); worlds = copy(snapshot.worldbooks); features = copy(snapshot.extension_settings.EjsTemplate)
    return { synchronized: true }
  }
}
