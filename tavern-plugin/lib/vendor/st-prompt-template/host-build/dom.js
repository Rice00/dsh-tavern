import { marked } from 'marked'
import { chat } from './host.js'

export function formatTemplateMessage(text) { return marked.parse(String(text ?? ''), { gfm: true }) }

// The mirror is only for upstream formatting. Card HTML executes in its visible DSH frame.
function inertMarkup(html) {
  const template = document.createElement('template'); template.innerHTML = html
  for (const element of template.content.querySelectorAll('*')) {
    const removed = [...element.attributes].filter(attr => /^on/i.test(attr.name) || (element.tagName === 'IFRAME' && ['src','srcdoc'].includes(attr.name)))
    if (!removed.length) continue
    element.setAttribute('data-template-inert-attributes', JSON.stringify(removed.map(attr => [attr.name,attr.value])))
    for (const attr of removed) element.removeAttribute(attr.name)
  }
  return template.innerHTML
}

export function templateMessageHTML(element) {
  if (!element) return ''
  const template = document.createElement('template'); template.innerHTML = element.innerHTML
  const clone = template.content
  for (const child of clone.querySelectorAll('[data-template-inert-attributes]')) {
    const attributes = JSON.parse(child.getAttribute('data-template-inert-attributes'))
    child.removeAttribute('data-template-inert-attributes')
    for (const [name,value] of attributes) child.setAttribute(name,value)
  }
  return template.innerHTML
}

function installMirrorFormatting() {
  const original = window.$.fn.html
  if (original.templateMirror) return
  function html(value) {
    if (typeof value === 'string' && this.length && this.toArray().every(element => element.closest?.('#chat'))) {
      return this.each(function () { this.innerHTML = inertMarkup(value) })
    }
    return original.apply(this,arguments)
  }
  html.templateMirror = true; window.$.fn.html = html
}

export function mountTemplateMessages() {
  let root = document.getElementById('chat')
  if (!root) { root = document.createElement('div'); root.id = 'chat'; root.hidden = true; document.body.append(root) }
  root.replaceChildren()
  chat.forEach((message, index) => {
    const row = document.createElement('div'); row.className = 'mes'; row.setAttribute('mesid', String(index))
    const content = document.createElement('div'); content.className = 'mes_text'; content.innerHTML = inertMarkup(formatTemplateMessage(message.mes))
    row.append(content); root.append(row)
  })
}

export function createTemplateDOMServices() {
  installMirrorFormatting()
  return {
    messageFormatting: formatTemplateMessage,
    updateMessageBlock(index, message) {
      if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.mes
      const element = document.querySelector(`.mes[mesid="${Number(index)}"] .mes_text`)
      if (element) element.innerHTML = inertMarkup(formatTemplateMessage(message.mes))
    },
    addCopyToCodeBlocks(parent) {
      for (const pre of parent[0]?.querySelectorAll('pre') || []) {
        if (pre.querySelector('[data-template-copy]')) continue
        const button = document.createElement('button'); button.dataset.templateCopy = ''; button.textContent = '复制'
        button.setAttribute('onclick', "navigator.clipboard.writeText(this.parentElement.querySelector('code')?.textContent || '')")
        pre.append(button)
      }
    },
    appendMediaToMessage(message, parent) {
      for (const media of message.extra?.media || []) {
        if (!media.url || parent[0]?.querySelector('[data-template-media="' + CSS.escape(media.url) + '"]')) continue
        const element = document.createElement(media.type === 'video' ? 'video' : media.type === 'audio' ? 'audio' : 'img')
        element.src = media.url; element.dataset.templateMedia = media.url
        if (element.tagName !== 'IMG') element.controls = true
        parent[0]?.append(element)
      }
    },
    updateReasoningUI(parent) {
      for (const block of parent[0]?.querySelectorAll('.mes_reasoning') || []) {
        block.hidden = !block.textContent.trim()
        block.setAttribute('aria-label', '推理内容')
      }
    },
    async callGenericPopup(html, _type, _input, options = {}) {
      const dialog = document.createElement('dialog'); dialog.className = 'template-popup'; dialog.innerHTML = String(html)
      const controls = document.createElement('footer'), save = document.createElement('button'), cancel = document.createElement('button')
      save.textContent = options.okButton || '保存'; cancel.textContent = '取消'; controls.append(save, cancel); dialog.append(controls)
      document.body.append(dialog); dialog.showModal(); await options.onOpen?.()
      return new Promise(resolve => {
        const close = async accepted => {
          const values = [...document.querySelectorAll('textarea')].filter(item => !dialog.contains(item)).map(item => [item, item.value])
          await options.onClose?.()
          if (!accepted) for (const [item, value] of values) { item.value = value; item.dispatchEvent(new Event('input', { bubbles: true })) }
          dialog.close(); dialog.remove(); resolve(accepted ? 1 : 0)
        }
        save.onclick = () => close(true); cancel.onclick = () => close(false)
        dialog.oncancel = event => { event.preventDefault(); void close(false) }
      })
    }
  }
}
