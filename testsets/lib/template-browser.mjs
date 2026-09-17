import { readFile } from 'node:fs/promises'

// Keep the production iframe, task protocol and versioned template assets intact.
// Only its parent-page RPC transport is supplied by this headless host.
export async function startTemplateBrowser({ origin, cookie, sessionId, chatId, timeoutMs = 60000 }) {
  const { chromium } = await import('playwright')
  const source = await readFile(new URL('../../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  let page
  async function close() {
    try {
      if (page && !page.isClosed()) await page.evaluate(async () => {
        window.templateExecutor?.dispose()
        await window.templateRelease
      })
    } finally { await browser.close() }
  }
  try {
    const context = await browser.newContext()
    await context.addCookies(cookie.split('; ').filter(Boolean).map(part => {
      const split = part.indexOf('=')
      return { name: part.slice(0, split), value: part.slice(split + 1), url: origin }
    }))
    page = await context.newPage()
    const shell = origin + '/__tavern_automation_template__'
    await page.route(shell, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>自动化模板执行器</body></html>' }))
    await page.goto(shell)
    await page.addScriptTag({ content: 'function isPlayMode(mode){return ["story","script"].includes(mode)}\n' + source })
    await page.evaluate(({ sessionId, chatId }) => {
      window.templateReady = false
      window.templateError = ''
      window.templateExecutor = createFullTemplateExecutor({ window,
        executeSlash: async () => { throw new Error('自动化模板宿主尚不支持浏览器斜杠命令') },
        rpc(method, args, owner, options) {
          if (args.initializationError) window.templateError = args.initializationError
          const pending = fetch('/api/dsh-tavern/' + method, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...args, sessionId: owner }), signal: options?.signal || AbortSignal.timeout(15000)
          }).then(async response => {
            if (!response.ok) throw new Error('模板 API HTTP ' + response.status)
            const result = await response.json()
            if (result.ok === false) throw new Error(result.error || '模板 API 失败')
            if (method === 'claimFullTemplateWork' && result.active && result.ready) window.templateReady = true
            return result
          })
          if (method === 'releaseFullTemplateRuntime') window.templateRelease = pending
          return pending
        }
      })
      window.templateExecutor.sync(sessionId, { chatId, mode: 'story' })
    }, { sessionId, chatId })
    await page.waitForFunction(() => window.templateReady || window.templateError, null, { timeout: timeoutMs })
    const error = await page.evaluate(() => window.templateError)
    if (error) throw new Error('自动化模板初始化失败：' + error)
    return { close }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}
