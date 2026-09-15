/** Own a session's complete template work, including persistence before receipt.
 * The plugin protects upstream global state; connection protects save ordering;
 * dispatch protects remote leases. This queue owns orchestration between them.
 */
export function createTemplateSessionTasks({ connection, plugin, dispatch }) {
  let tail = Promise.resolve(), closing = false, disposal
  function enqueue(action) {
    if (closing) return Promise.reject(new Error('Template session disposed'))
    const next = tail.then(action)
    tail = next.catch(() => {})
    return next
  }
  async function refreshed() {
    const snapshot = await connection.refresh()
    await plugin.refresh(snapshot)
    return snapshot
  }
  async function settled(action) {
    try { return await action() }
    finally { await connection.flush() }
  }
  async function project(operation, input) {
    const snapshot = await refreshed()
    if (operation === 'request' && input?.request?.model) snapshot.dsh.model = input.request.model
    return settled(() => plugin.project(operation, input))
  }
  return {
    context: connection.snapshot,
    project: (operation, input) => enqueue(() => project(operation, input)),
    synchronize: () => enqueue(async () => {
      const snapshot = await refreshed()
      return settled(() => plugin.synchronize(snapshot))
    }),
    refresh: () => enqueue(refreshed),
    flush: () => enqueue(() => connection.flush()),
    command: (...args) => enqueue(() => settled(() => plugin.command(...args))),
    emit: (...args) => enqueue(() => settled(() => plugin.emit(...args))),
    processChatCompletion: input => enqueue(() => settled(() => plugin.processChatCompletion(input))),
    // Start only after local work drains. A receipt transport failure must not
    // be reclassified as execution failure, nor cause the template to run twice.
    processNext: () => enqueue(async () => {
      const work = await dispatch.claim()
      if (!work.event) return false
      const started = await dispatch.start(work)
      if (!started.started) return true
      let receipt
      try {
        const result = await project(work.event.name, work.event.args[0])
        receipt = { args: [result] }
      } catch (error) {
        receipt = { error: String(error.stack || error) }
      }
      await dispatch.complete(work, receipt)
      return true
    }),
    dispose() {
      if (disposal) return disposal
      closing = true
      disposal = tail.then(async () => {
        try { await connection.flush() }
        finally { await plugin.dispose() }
      })
      return disposal
    }
  }
}
