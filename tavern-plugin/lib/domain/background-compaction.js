// Background maintenance runs inside the owning Agent turn, never through the
// idle Tavern compaction queue (which would wait for this same task to finish).
export async function compactBackgroundIfNeeded({ trigger, forced, mark, pressure }) {
  if (trigger !== 'context-overflow') {
    const budget = await pressure()
    if (!budget || budget.inputTokens + budget.outputTokens < budget.capacity) return null
  }
  // Persist first: even an interrupted summary may already have replaced history.
  await mark()
  return forced()
}

// Use the current task's route and output limit, not the last task's model.
// The meter includes durable system/tools/history; pending messages have not
// entered that surface yet. Provider-confirmed overflow remains the fallback
// for estimation error and models without capacity metadata.
export async function measureBackgroundBudget({ agent, background, signal, llm, meter, pending = [] }) {
  const selection = background.selection
  let info
  try { info = await llm.resolveModelInfo(selection.provider, selection.model, signal) }
  catch (error) {
    if (signal?.aborted) throw error
    return null
  }
  const capacity = info?.context?.contextWindow
  if (!Number.isFinite(capacity) || capacity <= 0) return null
  const previous = agent.session.requestHeader()
  const envelope = previous ? { ...previous, config: { ...previous.config, ...selection } } : undefined
  return {
    inputTokens: meter.measure(agent.session, envelope).totalTokens + pending.reduce((sum, message) => sum + meter.estimateMessage(message), 0),
    outputTokens: background.maxTokens ?? info.defaultMaxTokens ?? 0,
    capacity
  }
}
