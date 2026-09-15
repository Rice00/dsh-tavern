import { placementKey, promptOrder } from './worldbook-activation.js'
import { hasWorldbookRandom } from './worldbook-random.js'

// Move only changing entries and complete cross-entry tag spans that contain them.
export function foregroundWorldbookRefs(entries) {
  const ordered = promptOrder(entries.filter(entry => entry.enabled !== false))
  const refs = new Set(ordered.filter(entry => !entry.constant || entry.group || hasWorldbookRandom(entry.content)).map(entry => entry.ref))
  const buckets = new Map()
  for (const entry of ordered) {
    const key = placementKey(entry)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  for (const bucket of buckets.values()) {
    const stack = [], spans = []
    bucket.forEach((entry, index) => {
      const text = String(entry.content || '').replace(/<%[\s\S]*?%>/g, '')
      for (const match of text.matchAll(/<(\/?)\s*([\p{L}_][\p{L}\p{N}_:.-]*)(?:\s[^<>]*?)?\s*(\/?)>/gu)) {
        const [, closing, name, selfClosing] = match
        if (selfClosing || /^(?:br|hr|img|input|meta|link)$/i.test(name)) continue
        if (!closing) stack.push({ name, index })
        else if (stack.at(-1)?.name === name) {
          const start = stack.pop().index
          if (start !== index) spans.push([start, index])
        }
      }
    })
    // Inner spans complete before outer spans; whole nested wrappers stay together.
    for (const [start, end] of spans) if (bucket.slice(start, end + 1).some(entry => refs.has(entry.ref))) {
      for (const entry of bucket.slice(start, end + 1)) refs.add(entry.ref)
    }
  }
  return refs
}
