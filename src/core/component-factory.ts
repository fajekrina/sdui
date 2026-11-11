import type { SduiNode } from './node'
import type { RenderContext } from './render-context'
import type { RenderNode } from './render-node'
import { BUILTIN_COMPONENTS } from './components/builtins'

/// One component (descriptor): turns a node into a RenderNode. One small class
/// per JSON `type` — "add a component = one file". The class declares its type
/// as a static property:
///
/// ```ts
/// class RatingComponent implements Component {
///   static readonly type = 'rating'
///   makeView(node: SduiNode, ctx: RenderContext) { … }
/// }
/// ```
export interface Component {
  makeView(node: SduiNode, context: RenderContext): RenderNode | null
}

export interface ComponentType {
  readonly type: string
  /// builder palette metadata (optional)
  readonly category?: 'layout' | 'content' | 'form' | 'action'
  readonly acceptsChildren?: boolean
  readonly defaultProps?: Readonly<Record<string, unknown>>
}

/// An inline view builder: the one-line way to add a component.
export type ViewBuilder = (node: SduiNode, context: RenderContext) => RenderNode | null

export interface ComponentInfo {
  type: string
  category: 'layout' | 'content' | 'form' | 'action' | 'custom'
  acceptsChildren: boolean
  defaultProps: Readonly<Record<string, unknown>>
}

/// The one registry: a `type` string → a component (Factory pattern). Unknown
/// types fall back to the Null Object at render time — never a crash.
export class ComponentFactory {
  private readonly components = new Map<string, { component: Component; info: ComponentInfo }>()

  register(component: Component): this
  register(type: string, makeView: ViewBuilder, info?: Partial<Omit<ComponentInfo, 'type'>>): this
  register(componentOrType: Component | string, makeView?: ViewBuilder, info: Partial<Omit<ComponentInfo, 'type'>> = {}): this {
    if (typeof componentOrType === 'string') {
      if (!makeView) throw new TypeError('register(type, makeView) requires a view builder')
      this.components.set(componentOrType, {
        component: { makeView },
        info: { type: componentOrType, category: info.category ?? 'custom', acceptsChildren: info.acceptsChildren ?? false, defaultProps: info.defaultProps ?? {} }
      })
      return this
    }
    const ctor = componentOrType.constructor as Partial<ComponentType>
    if (typeof ctor.type !== 'string' || ctor.type.length === 0) throw new TypeError(`${componentOrType.constructor.name} has no static 'type'`)
    this.components.set(ctor.type, {
      component: componentOrType,
      info: { type: ctor.type, category: ctor.category ?? 'custom', acceptsChildren: ctor.acceptsChildren ?? false, defaultProps: ctor.defaultProps ?? {} }
    })
    return this
  }

  component(type: string): Component | undefined {
    return this.components.get(type)?.component
  }

  info(type: string): ComponentInfo | undefined {
    return this.components.get(type)?.info
  }

  /// Registered type strings, sorted.
  get registeredTypes(): string[] {
    return [...this.components.keys()].sort()
  }

  /// Registration order grouped by category — the builder palette.
  palette(): ComponentInfo[] {
    const order = ['layout', 'content', 'form', 'action', 'custom']
    return [...this.components.values()].map((c) => c.info).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
  }

  /// A factory pre-loaded with the built-in components (v1 + v1.1).
  static withBuiltins(): ComponentFactory {
    const factory = new ComponentFactory()
    for (const Builtin of BUILTIN_COMPONENTS) factory.register(new Builtin())
    return factory
  }
}
