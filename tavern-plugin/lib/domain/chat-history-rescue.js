/** Salvage only persisted narrative; never consult the damaged native Session. */
export function rescueHistoryInput(source) {
  if (!source || !['story', 'script'].includes(source.mode || 'story')) throw new Error('只能救援已有游玩存档')
  if (!source.cardPath) throw new Error('旧存档没有关联人物卡，无法迁移')
  const rows = (source.messages || []).filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.text === 'string' && m.text.trim())
  if (!rows.length) throw new Error('旧存档中没有可迁移的剧情文字')
  return {
    cardPath: source.cardPath, userName: source.macroState?.userName || '你',
    fileName: (source.title || source.cardName || '旧对话') + ' · 文字救援',
    textOnly: true, rescue: { sourceChatId: source.id, sourceRevision: source._storageRevision || 0 },
    text: [JSON.stringify({ user_name: source.macroState?.userName || '你', chat_metadata: {} }),
      ...rows.map(m => JSON.stringify({ is_user: m.role === 'user', mes: m.text }))].join('\n')
  }
}
export function isRescuedHistoryMessage(chat, message) {
  return Boolean(chat.importHistory?.rescue && message?.importSource?.operationId === chat.importHistory.operationId)
}
export function assertRescueHistoryEditable(chat) {
  if (isRescuedHistoryMessage(chat, (chat.messages || []).findLast(m => m.role === 'assistant'))) {
    throw new Error('坏档救援导入的历史仅供接续剧情，不能回退或重新生成；请发送新消息继续')
  }
}
