import { registerEjsLanguage } from '../upstream/src/modules/code-editor.ts?language-only'
let ready
export async function createEjsCodeEditor(container, options) {
  ready ||= import('monaco-editor').then(monaco => { registerEjsLanguage(monaco); return monaco })
  const monaco = await ready
  const model = monaco.editor.createModel(options.value || '', 'ejs')
  const editor = monaco.editor.create(container, {
    model, editContext: false, theme: options.dark ? 'vs-dark' : 'vs', automaticLayout: true,
    fontSize: 14, wordWrap: 'on', minimap: { enabled: false },
    scrollBeyondLastLine: false, bracketPairColorization: { enabled: true },
    ariaLabel: 'EJS 模板代码'
  })
  return { getValue: () => editor.getValue(), focus: () => editor.focus(),
    dispose() { editor.dispose(); model.dispose() } }
}
