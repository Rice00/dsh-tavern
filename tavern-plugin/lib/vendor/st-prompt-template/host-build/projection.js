import { entryRandom } from '../../../domain/worldbook-random-sequence.js'
import { eventSource } from './host.js'
import { prepareContext, evalTemplate } from '../upstream/src/function/ejs.ts'
import { STATE } from '../upstream/src/function/variables.ts'
import { handleInitialVariables } from '../upstream/src/features/initial-variables.ts'
import { getEnabledWorldInfoEntries, deactivateActivateWorldInfo, getActivatedWIEntries } from '../upstream/src/function/worldinfo.ts'
import { chat, chat_metadata, extension_settings } from './host.js'

const copy = value => structuredClone(value || {})

/** Native projection adapter; parsing, evaluation, variables and worldbook APIs are upstream-owned. */
export async function projectTemplate(operation, input) {
  const context = input.context || {}
  if (context.scopes) {
    extension_settings.variables ||= {}
    extension_settings.variables.global = copy(context.scopes.global)
    chat_metadata.variables = copy(context.scopes.local)
    STATE.initialVariables = copy(context.scopes.initial)
    if (chat.length) {
      const message = chat.at(-1)
      message.variables ||= []
      message.variables[message.swipe_id || 0] = copy(context.scopes.message)
    }
  }
  deactivateActivateWorldInfo()
  const env = await prepareContext(-1, { ...context.locals, runType: context.runType || 'generate', generateType: context.generateType || '' })
  const activations = () => getActivatedWIEntries().flatMap(entry => {
    const resource = (context.worldBookEntries || []).find(item => String(item.uid ?? item.id) === String(entry.uid) && (!item.world || item.world === entry.world))
    return resource ? [{ ref: resource.ref, force: Boolean(entry.hash) }] : []
  })
  const scopes = () => ({ global: copy(extension_settings.variables?.global), local: copy(chat_metadata.variables),
    initial: copy(STATE.initialVariables), message: copy(chat.at(-1)?.variables?.[chat.at(-1)?.swipe_id || 0]) })
  if (operation === 'initialize') {
    await handleInitialVariables(env, await getEnabledWorldInfoEntries())
    return { initial: copy(STATE.initialVariables), scopes: scopes(), evaluated: 1, diagnostics: [] }
  }
  if (operation === 'request') {
    const messages = copy(input.request.messages)
    const hasSystem = typeof input.request.system === 'string'
    if (hasSystem) messages.unshift({ role: 'system', content: input.request.system })
    const result = await projectTemplate('messages', { messages, context })
    return { messages: hasSystem ? result.messages.slice(1) : result.messages, ...(hasSystem ? { system: result.messages[0].content } : {}) }
  }
  if (operation === 'messages') {
    const request = { messages: copy(input.messages), type: context.generateType || 'normal' }
    await eventSource.emit('GENERATION_AFTER_COMMANDS', request.type, {}, false)
    await eventSource.emit('CHAT_COMPLETION_SETTINGS_READY', request)
    return { messages: request.messages, scopes: scopes(), diagnostics: [], evaluated: input.messages.length }
  }
  if (operation === 'render') {
    const previousRandom = Math.random
    let randomCalls = 0
    if (context.randomSeed) { const random = entryRandom(context.randomSeed, context.randomRef); Math.random = () => { randomCalls++; return random() } }
    try {
      const text = await evalTemplate(input.template, env, { logging: false })
      return { ok: true, text, randomCalls, scopes: scopes(), activationRequests: activations(), evaluated: input.template.includes('<%') }
    } catch (error) { return { ok: false, kind: error instanceof SyntaxError ? 'syntax-error' : 'runtime-error', error: String(error.message || error) } }
    finally { Math.random = previousRandom }
  }
  throw new Error('Unknown full template projection: ' + operation)
}
