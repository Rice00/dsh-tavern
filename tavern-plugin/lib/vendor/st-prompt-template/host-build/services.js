import { executeTemplateSlash } from './commands.js'
import { createTemplateDOMServices } from './dom.js'
import { renderTavernMacros } from '../../../domain/tavern-macro-engine.js'
import { applyTavernRegexText } from '../../../domain/tavern-regex-display.js'
import { chat_metadata, extension_settings, name1, name2 } from './host.js'

export function createTemplateServices(context, rpc) {
  return {
    ...createTemplateDOMServices(),
    getUserAvatar: () => context()?.user_avatar || '',
    getCharaFilename: () => context()?.dsh?.cardPath || '',
    getChatCompletionModel: () => context()?.dsh?.model || '',
    getThumbnailUrl: (_kind, file) => file || '',
    substituteParams(value) {
      const result = renderTavernMacros(String(value), { charName: name2, userName: name1,
        localVariables: chat_metadata.variables || {}, globalVariables: extension_settings.variables?.global || {} })
      chat_metadata.variables = result.localVariables
      extension_settings.variables ||= {}
      extension_settings.variables.global = result.globalVariables
      return result.text
    },
    getRegexedString: (value, placement, options = {}) => applyTavernRegexText(value, [...(context()?.dsh?.regexScripts || []), ...(extension_settings.regex || [])], { ...options, placement }).text,
    getTokenCountAsync: value => rpc('countFullTemplateTokens', { text: String(value) }).then(result => result.tokens),
    executeSlashCommandsWithOptions: source => executeTemplateSlash(source, text => rpc('executeTemplateHostCommand', { text })),
    copyText: value => navigator.clipboard.writeText(String(value))
  }
}
