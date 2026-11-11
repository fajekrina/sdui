import { DataContext, RenderContext, type ComponentFactory, type RenderNode, type SduiNode, type SduiValue } from '../core'

/// Render a node tree for the builder canvas with the SAME components the client
/// uses (preview == client), non-interactive, every node tagged with
/// `data-sdui-node` so a click on the canvas can select it.
export function renderPreview(factory: ComponentFactory, root: SduiNode, options: { data?: Record<string, SduiValue>; selected?: string; assetURL?: (name: string) => string } = {}): RenderNode | null {
  const ctx = new RenderContext(new DataContext(options.data ?? {}), {
    factory,
    ui: { toasts: [], forms: {} },
    interactive: false,
    debug: true,
    loading: false,
    assetURL: options.assetURL ?? ((name) => name),
    slots: new Set(),
    sink: { bindAction: (key) => key, registerField: () => {}, unknownComponent: () => {} }
  })
  const view = ctx.view(root)
  if (!view) return null
  const ids = new Set<string>()
  const collect = (n: SduiNode) => { if (n.id) ids.add(n.id); n.children.forEach(collect) }
  collect(root)
  const tag = (n: RenderNode): RenderNode => {
    const own = ids.has(n.key)
    return {
      ...n,
      attrs: own ? { ...n.attrs, 'data-sdui-node': n.key } : n.attrs,
      style: own && n.key === options.selected ? { ...n.style, outline: '2px solid #2563EB', outlineOffset: '2px' } : n.style,
      children: n.children.map(tag)
    }
  }
  return tag(view)
}

/// 0-based line range of the node with this id inside pretty-printed JSON text —
/// the object that directly holds `"id": "<id>"`. Tolerant (string/escape aware,
/// no JSON.parse), so it also works on temporarily invalid text.
export function findNodeJsonRange(text: string, id: string | undefined): { startLine: number; endLine: number } | null {
  if (!id || !text) return null
  const stack: number[] = []
  let pendingKey: string | null = null
  let found = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { value += text[j + 1] ?? ''; j += 2; continue }
        value += text[j]; j++
      }
      let k = j + 1
      while (k < text.length && /\s/.test(text[k]!)) k++
      if (text[k] === ':') pendingKey = value
      else {
        if (found < 0 && pendingKey === 'id' && value === id && stack.length > 0) found = stack[stack.length - 1]!
        pendingKey = null
      }
      i = j
      continue
    }
    if (ch === '{') { stack.push(i); pendingKey = null; continue }
    if (ch === '[') { stack.push(-1); pendingKey = null; continue }
    if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if (found >= 0 && open === found) {
        const lineOf = (pos: number) => text.slice(0, pos).split('\n').length - 1
        return { startLine: lineOf(found), endLine: lineOf(i) }
      }
      pendingKey = null
      continue
    }
    if (ch === ',') pendingKey = null
  }
  return null
}
