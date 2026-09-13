import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

for (const file of ['src/client/main.js', 'lib/client.js']) {
  test(`${file}: system prompt panel renders loading and loaded states without preset context`, () => {
    const source = readFileSync(new URL('../tavern-plugin/' + file, import.meta.url), 'utf8')
    const component = source.slice(source.indexOf('function SystemPromptSidebarTab()'), source.indexOf('function createResourcesLibraryFeatureModule()'))
    for (const loading of [true, false]) {
      const React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: initial => [{ ...initial, loading, prompts: [{ name: 'system-append', label: 'system附加指令', text: '' }] }, () => {}],
        useRef: () => ({ current: null }), useEffect: () => {}
      }
      const render = new Function('React', component + '; return SystemPromptSidebarTab;')(React)
      const tree = render()
      assert.match(JSON.stringify(tree), /系统提示词/)
      if (!loading) assert.match(JSON.stringify(tree), /system附加指令/)
      assert.doesNotMatch(JSON.stringify(tree), /应用到当前游戏/)
    }
  })
}
