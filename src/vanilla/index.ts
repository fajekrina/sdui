// @fajekrina/sdui/vanilla — the framework-free renderer: `mount(el, options)`.
import { ScreenSource, type SduiEngine } from '../core/engine'
import type { ScreenController } from '../core/screen'
import type { RenderNode } from '../core/render-node'
import type { SduiValue } from '../core/value'
import type { BytesLike } from '../core/bytes'

export type ScreenSourceInput = ScreenSource | { key: string } | { named: string } | { payload: BytesLike | object }
/// Toolkit-specific components: `{ chart: (slot, node) => element }`.
export type DomSlots = Record<string, (slot: NonNullable<RenderNode['slot']>, node: RenderNode) => Node>

const SVG_NS = 'http://www.w3.org/2000/svg'

export function toScreenSource(input: ScreenSourceInput): ScreenSource {
  if ('kind' in input) return input as ScreenSource
  if ('key' in input) return ScreenSource.key(input.key)
  if ('named' in input) return ScreenSource.named(input.named)
  return ScreenSource.inline(input.payload)
}

/// Build DOM for one RenderNode (and its subtree).
export function renderNodeDOM(node: RenderNode, screen?: ScreenController, slots?: DomSlots, doc: Document = document): Node {
  if (node.slot && slots?.[node.slot.type]) {
    const wrap = doc.createElement('div')
    wrap.setAttribute('data-sdui-slot', node.slot.type)
    Object.assign(wrap.style, node.style)
    wrap.appendChild(slots[node.slot.type]!(node.slot, node))
    return wrap
  }
  const isSvg = node.element === 'svg' || node.element === 'path'
  const el = isSvg ? doc.createElementNS(SVG_NS, node.element) : doc.createElement(node.element)
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const [k, v] of Object.entries(node.style)) (el as HTMLElement).style.setProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v)
  el.setAttribute('data-sdui-key', node.key)
  if (node.text != null && node.text !== '') el.appendChild(doc.createTextNode(node.text))

  if (node.field && screen) {
    const { formId, name } = node.field
    const input = el as HTMLInputElement
    input.value = String(node.attrs.value ?? '')
    if (node.element === 'select') queueMicrotask(() => { input.value = String(node.attrs.value ?? '') })
    input.addEventListener(node.element === 'select' ? 'change' : 'input', () => screen.setFieldValue(formId, name, input.value))
  }
  if (node.on?.click && screen) {
    const key = node.on.click
    el.addEventListener('click', (e) => { e.preventDefault(); void screen.handle(key) })
  }
  if (node.element === 'form') el.addEventListener('submit', (e) => e.preventDefault())
  for (const child of node.children) el.appendChild(renderNodeDOM(child, screen, slots, doc))
  return el
}

export interface MountOptions {
  engine: SduiEngine
  source: ScreenSourceInput
  seed?: Record<string, SduiValue>
  interactive?: boolean
  slots?: DomSlots
}

export interface MountedScreen {
  readonly screen: ScreenController
  /// switch to another source (fresh data and state)
  update(source: ScreenSourceInput, seed?: Record<string, SduiValue>): void
  destroy(): void
}

export function mount(target: HTMLElement, options: MountOptions): MountedScreen {
  const doc = target.ownerDocument
  const root = doc.createElement('div')
  target.appendChild(root)
  let screen: ScreenController
  let unsubscribe = () => {}

  const paint = () => {
    // keep focus and caret in the field being typed into
    const active = doc.activeElement as HTMLInputElement | null
    const activeKey = active?.getAttribute?.('data-sdui-key')
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : undefined
    const result = screen.render({ interactive: options.interactive ?? true, slots: options.slots ? Object.keys(options.slots) : undefined })
    root.setAttribute('data-sdui-screen', ScreenSource.identity(screen.source))
    root.replaceChildren(...result.nodes.map((n) => renderNodeDOM(n, screen, options.slots, doc)), ...result.overlays.map((n) => renderNodeDOM(n, screen, options.slots, doc)))
    if (activeKey) {
      const again = root.querySelector<HTMLInputElement>(`[data-sdui-key="${CSS.escape(activeKey)}"]`)
      if (again) {
        again.focus()
        if (caret && caret[0] != null) try { again.setSelectionRange(caret[0], caret[1] ?? caret[0]) } catch { /* not a text field */ }
      }
    }
  }

  const start = (source: ScreenSourceInput, seed?: Record<string, SduiValue>) => {
    unsubscribe()
    screen?.destroy()
    screen = options.engine.screen(toScreenSource(source), { seed })
    unsubscribe = screen.subscribe(paint)
    paint()
    void screen.load()
  }
  start(options.source, options.seed)

  return {
    get screen() { return screen },
    update: start,
    destroy() {
      unsubscribe()
      screen.destroy()
      root.remove()
    }
  }
}
