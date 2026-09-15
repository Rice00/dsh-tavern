import { renderTavernMacros } from '../../../domain/tavern-macro-engine.js'
import { applyTavernRegexText } from '../../../domain/tavern-regex-display.js'
import { chat_metadata, extension_settings, name1, name2 } from './host.js'

export function createTemplateServices(context, rpc) {
  return {
    getUserAvatar: () => context()?.user_avatar || '',
    getCharaFilename: () => context()?.dsh?.cardPath || '',
    getChatCompletionModel: () => context()?.dsh?.model || '',
    getThumbnailUrl: (_kind, file) => file || '',
    substituteParams(value) {
      const result = renderTavernMacros(String(value), { charName: name2, userName: name1,
        localVariables: chat_metadata.variables || {}, globalVariables: extension_settings.variables?.global || {} })
      return result.text
    },
    getRegexedString: (value, placement, options = {}) => applyTavernRegexText(value, context()?.dsh?.regexScripts || [], { ...options, placement }).text,
    getTokenCountAsync: value => rpc('countFullTemplateTokens', { text: String(value) }).then(result => result.tokens),
    copyText: value => navigator.clipboard.writeText(String(value))
  }
}
