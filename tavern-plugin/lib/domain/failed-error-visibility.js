// Error visibility is presentation state, never a rollback or story suppression.
export function setFailedErrorVisibility(chat, events, turn, hidden) {
  if (!Number.isSafeInteger(turn) || turn < 1 || typeof hidden !== 'boolean') throw new Error('无效的错误提示参数')
  if (!events.some(event => event?.type === 'turn/end' && event.data?.turn === turn && event.data?.reason?.kind === 'error')) {
    throw new Error('找不到该轮的运行错误，请刷新后重试')
  }
  const turns = new Set((chat.hiddenDshErrorTurns || []).filter(value => Number.isSafeInteger(value) && value > 0))
  if (hidden) turns.add(turn)
  else turns.delete(turn)
  return { ...chat, hiddenDshErrorTurns: [...turns].sort((a, b) => a - b) }
}
