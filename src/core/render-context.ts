import { DataContext } from './data-context'
import { tokenKeys } from './token'
import { renderNode, type RenderNode } from './render-node'
import type { ComponentFactory } from './component-factory'
import type { ActionSpec } from './actions/spec'
import type { SduiNode } from './node'
import type { SduiValue } from './value'
import type { UiState } from './ui-store'
import type { FieldRule } from './patterns'

/// What the render pass reports back to the screen controller.
export interface RenderSink {
  /// register a handler; returns the key the RenderNode carries
  bindAction(key: string, action: ActionSpec, data: DataContext, formId?: string): string
  registerField(formId: string, rule: FieldRule): void
  unknownComponent(type: string): void
}

export interface RenderEnvironment {
  factory: ComponentFactory
  ui: UiState
  interactive: boolean
  debug: boolean
  /// a `screen.load` request is still pending
  loading: boolean
  assetURL(name: string): string
  /// toolkit-specific component types rendered by the adapter (slots)
  slots: ReadonlySet<string>
  sink: RenderSink
}

/// Everything a component needs to render, plus the glue: the data context,
/// token resolution, child scoping, and Composite recursion.
export class RenderContext {
  constructor(
    readonly data: DataContext,
    readonly env: RenderEnvironment,
    /// position path → stable keys for nodes without an id
    readonly path: string = '0',
    /// the enclosing form, if any
    readonly formId?: string
  ) {}

  get interactive(): boolean { return this.env.interactive }
  get ui(): UiState { return this.env.ui }

  /// Interpolate `{{token}}`s against the data context.
  resolve(template: string): string {
    return this.data.resolve(template)
  }

  /// true while a `screen.load` is pending and the template still has a missing token
  pending(template: string): boolean {
    return this.env.loading && tokenKeys(template).some((k) => this.data.value(k) === undefined)
  }

  /// A key for a node: its id, else its position.
  keyFor(node: SduiNode): string {
    return node.id ?? `p${this.path}`
  }

  /// The context for a child at `index`, optionally with extra scoped data
  /// (a list row, a form) that never leaks into the parent.
  child(index: number | string, extra?: Record<string, SduiValue>, formId?: string): RenderContext {
    const data = extra ? new DataContext({ ...this.data.snapshot, ...extra }) : this.data
    return new RenderContext(data, this.env, `${this.path}.${index}`, formId ?? this.formId)
  }

  /// Render a node: Composite recursion with the Null-Object fallback.
  view(node: SduiNode): RenderNode | null {
    const component = this.env.factory.component(node.type)
    if (component) return component.makeView(node, this)
    if (this.env.slots.has(node.type)) {
      return renderNode(this.keyFor(node), 'div', {
        type: node.type,
        attrs: { 'data-sdui-slot': node.type },
        slot: { type: node.type, props: node.props, data: this.data.snapshot }
      } as Partial<RenderNode>)
    }
    this.env.sink.unknownComponent(node.type)
    if (!this.env.debug) return null
    return renderNode(this.keyFor(node), 'span', {
      type: node.type,
      attrs: { 'aria-hidden': 'true', 'data-sdui-unknown': node.type },
      style: { display: 'inline-block', fontSize: '11px', color: '#6B7280', padding: '4px', border: '1px dashed #9CA3AF', borderRadius: '4px' },
      text: `⚠︎ unknown: ${node.type}`
    })
  }

  /// Render children in order, keyed by `id ?? position`.
  children(node: SduiNode, extra?: Record<string, SduiValue>, formId?: string): RenderNode[] {
    const out: RenderNode[] = []
    node.children.forEach((child, i) => {
      const view = this.child(i, extra, formId).view(child)
      if (view) out.push(view)
    })
    return out
  }

  /// Wire an action to a click; returns the `on` map (empty when not interactive).
  onClick(node: SduiNode, action: ActionSpec | undefined): RenderNode['on'] {
    if (!action || !this.interactive) return undefined
    return { click: this.env.sink.bindAction(`a:${this.keyFor(node)}`, action, this.data, this.formId) }
  }
}
