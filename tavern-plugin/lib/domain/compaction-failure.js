/** Expose actionable overflow classification without leaking nested provider payloads. */
export function compactionFailureMessage(error) {
  const seen = new Set()
  let cause = error
  for (let depth = 0; cause && depth < 12 && !seen.has(cause); depth++) {
    seen.add(cause)
    if (cause.code === 'CONTEXT_WINDOW_EXCEEDED' || /context (?:window|length).*(?:exceed|overflow)|context overflow|maximum context length|上下文.*超限/i.test(String(cause.message || ''))) {
      return '压缩输入超出模型上下文窗口。请检查模型设置中的真实 contextWindow，或改用更大窗口的摘要模型后重试。'
    }
    cause = cause.cause
  }
  return String(error?.message || error || '上下文压缩失败').slice(0, 500)
}
