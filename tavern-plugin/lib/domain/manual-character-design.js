import { createCharacterDesignDocumentSession } from './character-design-document.js'

/** One explicit request, with drafts committed only after the agent succeeds. */
export function createManualCharacterDesign({ store, runAgent, selection, onError = error => console.error('人物设计保存状态失败', error) }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.characterDesignTask || { status: 'idle' }
    return state.status === 'running' && !jobs.has(chat.id)
      ? { ...state, status: 'failed', error: '人物设计已中断，请重试。' } : state
  }
  async function start({ sessionId, guidance }) {
    const request = String(guidance || '').trim()
    if (!request || request.length > 4000) throw new Error('请填写人物与设计要求（最多 4000 字）')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    jobs.set(chat.id, true)
    try {
      await store.updateChat(chat.id, draft => {
        draft.characterDesignTask = { status: 'running', guidance: request, error: '' }
        return draft
      })
    } catch (error) { jobs.delete(chat.id); throw error }
    const task = execute(chat, request, model).catch(onError).finally(() => jobs.delete(chat.id))
    jobs.set(chat.id, task)
    return { status: 'running' }
  }
  async function execute(chat, guidance, model) {
    try {
      const draft = createCharacterDesignDocumentSession({ document: chat.characterDesignDocument })
      const card = await store.readCard(chat)
      const recent = (chat.messages || []).filter(message => message.role === 'user' || message.role === 'assistant').slice(-12)
        .map(message => ({ role: message.role, text: message.sourceText || message.text || '' }))
      await runAgent({
        task: 'character-design', persistent: false, sessionId: chat.sessionId, chatId: chat.id, selection: model,
        backgroundTasks: { variables: false, posture: false, characterDesign: true },
        system: '本次仅执行用户明确要求的人物设计。先调用 skill 加载 character-design，读取已有档案，按要求创建或修订，再调用 character_design_save 保存。不得执行变量或姿势结算，不得改写正文。',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ guidance, card: { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario }, recent }) }] }],
        tools: draft.tools, onToolCall: call => draft.execute(call)
      })
      if (!draft.changed()) throw new Error('模型未保存人物设计档案，请重试或补充设计要求。')
      await store.updateChat(chat.id, current => {
        current.characterDesignDocument = draft.document()
        current.characterDesignTask = { status: 'done', guidance, error: '' }
        return current
      })
    } catch (error) {
      await store.updateChat(chat.id, current => {
        current.characterDesignTask = { status: 'failed', guidance, error: String(error.message || error) }
        return current
      })
    }
  }
  return { start, project, wait: chatId => jobs.get(chatId) }
}
