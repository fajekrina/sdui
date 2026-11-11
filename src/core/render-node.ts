/// RenderNode — the contract between the core and every renderer.
///
/// Every rendering decision (element, sanitized attributes, final style, text,
/// field binding, event wiring) is made in the core, once. React, Vue and
/// vanilla render RenderNodes generically and never branch on component type —
/// which is what keeps the three pixel-identical.

export type RenderElement =
  | 'div' | 'span' | 'p' | 'img' | 'button' | 'form' | 'input' | 'select' | 'option'
  | 'textarea' | 'label' | 'hr' | 'ul' | 'li' | 'svg' | 'path'

export interface RenderNode {
  /// stable key for reconciliation (node id, else its position path)
  key: string
  /// component type when this node is the root of a component
  type?: string
  element: RenderElement
  /// already sanitized; booleans are only present when true
  attrs: Record<string, string | number | boolean>
  /// final inline style (closed vocabulary → CSS); never author-supplied CSS
  style: Record<string, string>
  /// text content — renderers render it as text, never as HTML
  text?: string
  /// form field binding: the value lives in the UI store
  field?: { formId: string; name: string }
  /// event → handler key, passed back to `screen.handle(key)`
  on?: { click?: string; submit?: string }
  preventDefault?: boolean
  /// a toolkit-specific component the adapter renders itself (React chart, map…)
  slot?: { type: string; props: Record<string, unknown>; data: Record<string, unknown> }
  children: RenderNode[]
}

export interface RenderResult {
  nodes: RenderNode[]
  /// toasts from the UI store
  overlays: RenderNode[]
}

export function renderNode(key: string, element: RenderElement, extra: Partial<RenderNode> = {}): RenderNode {
  return { key, element, attrs: {}, style: {}, children: [], ...extra }
}

/// Drop empty/false attributes so renderers can spread them as-is.
export function cleanAttrs(attrs: Record<string, string | number | boolean | undefined | null>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || v === '') continue
    out[k] = v
  }
  return out
}
