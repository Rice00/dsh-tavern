import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { readTavernClientAsset, TAVERN_CLIENT_ASSET_PREFIX } from '../tavern-plugin/lib/domain/tavern-client-assets.js'

test('Tavern 客户端样式作为独立本地资源提供', async () => {
  assert.equal(TAVERN_CLIENT_ASSET_PREFIX, '/api/dsh-tavern/client-assets/')
  const asset = await readTavernClientAsset('/api/dsh-tavern/client-assets/tavern.css')
  assert.equal(asset.mediaType, 'text/css; charset=utf-8')
  assert.match(asset.body.toString('utf8'), /\.dsh-tavern-sidebar/)
  assert.match(asset.body.toString('utf8'), /@keyframes dsh-tavern-pulse/)
})

test('Web 宿主加载带版本的样式，并在新样式就绪前保留旧样式', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const links = []
  const document = {
    defaultView: { clearTimeout() {}, removeEventListener() {} },
    querySelectorAll() { return links },
    createElement() {
      return { dataset: {}, events: {}, addEventListener(name, fn) { this.events[name] = fn }, getAttribute(name) { return this[name] }, remove() { links.splice(links.indexOf(this), 1) } }
    },
    head: { appendChild(node) { links.push(node) } }
  }
  let descriptor
  vm.runInNewContext(source, { document, window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  descriptor.factory(() => ({}))
  assert.equal(links.length, 1)
  const current = links[0]
  assert.equal(current.rel, 'stylesheet')
  assert.equal(current.dataset.pluginCss, 'dsh-tavern-plugin/tavern.css')
  assert.equal(current.href, '/api/dsh-tavern/client-assets/tavern.css?v=20260913-preset-drag')
  descriptor.factory(() => ({}))
  assert.equal(links.length, 1, 'do not duplicate an in-flight request')
  current.sheet = {}; current.events.load()
  descriptor.factory(() => ({}))
  assert.equal(links.length, 1)
  // Replay a newer module with a changed resource version.
  vm.runInNewContext(source.replaceAll('20260913-preset-drag', 'next-version'), { document, window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  descriptor.factory(() => ({}))
  assert.equal(links.length, 2)
  assert.equal(links[0], current, 'old styles remain while fetching the update')
  links[1].sheet = {}; links[1].events.load()
  assert.equal(links.length, 1)
  assert.match(links[0].href, /next-version/)
  assert.doesNotMatch(source, /const TAVERN_CSS\s*=\s*`/)
})
