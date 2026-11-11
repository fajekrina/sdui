import {
  ActionSpec, SchemaValidator, SduiNode, SduiPayload, ScreenSpec, SPEC_VERSION, sortedJSONStringify,
  type LoadRequest, type Presentation, type SduiProps, type ToastLevel
} from '../core'

// The TypeScript DSL — the counterpart of MurtiBuilder:
//
//   screen('home', vstack({ spacing: 12 }, [
//     text('Halo, {{user.name}}', { style: 'title' }),
//     button('Detail', navigate('productDetail')),
//   ])).validated().toJSON()
//
// Children are arrays; `false`/`null`/`undefined` entries drop out and nested
// arrays flatten, so `cond && text(…)` and `items.map(…)` give you `if` and `for`.

export type Child = NodeBuilder | SduiNode | Child[] | null | undefined | false

/// A node under construction. `.action(…)` attaches an action to any node.
export class NodeBuilder {
  constructor(
    private readonly type: string,
    private readonly props: SduiProps = {},
    private readonly kids: Child[] = [],
    private readonly act?: ActionSpec,
    private readonly nodeId?: string
  ) {}

  action(action: ActionBuilder | ActionSpec): NodeBuilder {
    return new NodeBuilder(this.type, this.props, this.kids, toSpec(action), this.nodeId)
  }

  /// A stable id (e.g. a form's id, which scopes its fields).
  id(id: string): NodeBuilder {
    return new NodeBuilder(this.type, this.props, this.kids, this.act, id)
  }

  node(): SduiNode {
    return new SduiNode({ id: this.nodeId, type: this.type, props: clean(this.props), children: buildChildren(this.kids), action: this.act })
  }
}

export function buildChildren(children: Child[]): SduiNode[] {
  const out: SduiNode[] = []
  const visit = (c: Child) => {
    if (c === null || c === undefined || c === false) return
    if (Array.isArray(c)) { c.forEach(visit); return }
    out.push(c instanceof SduiNode ? c : c.node())
  }
  children.forEach(visit)
  return out
}

const clean = (props: SduiProps): SduiProps => Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as SduiProps

type Props = Record<string, SduiProps[string] | undefined>

function container(type: string) {
  function build(children?: Child[]): NodeBuilder
  function build(props: Props, children?: Child[]): NodeBuilder
  function build(a?: Props | Child[], b?: Child[]): NodeBuilder {
    if (Array.isArray(a)) return new NodeBuilder(type, {}, a)
    return new NodeBuilder(type, (a ?? {}) as SduiProps, b ?? [])
  }
  return build
}

export const vstack = container('vstack')
export const hstack = container('hstack')
export const zstack = container('zstack')
export const card = container('card')
export const grid = container('grid')
export const scroll = container('scroll')
export const form = container('form')

export function text(value: string, props: Props = {}): NodeBuilder { return new NodeBuilder('text', { value, ...props } as SduiProps) }
export function image(props: Props): NodeBuilder { return new NodeBuilder('image', props as SduiProps) }
export function spacer(props: Props = {}): NodeBuilder { return new NodeBuilder('spacer', props as SduiProps) }
export function divider(): NodeBuilder { return new NodeBuilder('divider') }
export function textField(props: Props & { name: string }): NodeBuilder { return new NodeBuilder('textField', props as SduiProps) }
export function textArea(props: Props & { name: string }): NodeBuilder { return new NodeBuilder('textArea', props as SduiProps) }
export function picker(props: Props & { name: string }): NodeBuilder { return new NodeBuilder('picker', props as SduiProps) }
/// `list({ items: 'getPromos.items', as: 'promo' }, [ …row template… ])`
export function list(props: Props & { items: string }, template: Child[]): NodeBuilder { return new NodeBuilder('list', props as SduiProps, template) }
export function button(title: string, action?: ActionBuilder | ActionSpec, props: Props = {}): NodeBuilder {
  return new NodeBuilder('button', { title, ...props } as SduiProps, [], action ? toSpec(action) : undefined)
}
/// Any registered or third-party type — the escape hatch of the open registry.
export function component(type: string, props: Props = {}, children: Child[] = []): NodeBuilder {
  return new NodeBuilder(type, props as SduiProps, children)
}

// MARK: - Actions

export interface ChainOptions {
  params?: SduiProps
  onSuccess?: ActionBuilder | ActionSpec
  onError?: ActionBuilder | ActionSpec
}

export class ActionBuilder {
  constructor(readonly spec: ActionSpec) {}
}

const toSpec = (a: ActionBuilder | ActionSpec): ActionSpec => (a instanceof ActionBuilder ? a.spec : a)
const chain = (o: ChainOptions) => ({ params: o.params, onSuccess: o.onSuccess && toSpec(o.onSuccess), onError: o.onError && toSpec(o.onError) })

export function navigate(screen: string, options: ChainOptions & { presentation?: Presentation } = {}): ActionBuilder {
  return new ActionBuilder(new ActionSpec({ type: 'navigate', screen, presentation: options.presentation, ...chain(options) }))
}
export function api(request: string, options: ChainOptions = {}): ActionBuilder {
  return new ActionBuilder(new ActionSpec({ type: 'api', request, ...chain(options) }))
}
export function native(command: string, options: ChainOptions = {}): ActionBuilder {
  return new ActionBuilder(new ActionSpec({ type: 'native', command, ...chain(options) }))
}
export function toast(message: string, options: { level?: ToastLevel; onSuccess?: ActionBuilder | ActionSpec } = {}): ActionBuilder {
  return new ActionBuilder(new ActionSpec({ type: 'toast', message, level: options.level, onSuccess: options.onSuccess && toSpec(options.onSuccess) }))
}
export function dismiss(): ActionBuilder { return new ActionBuilder(new ActionSpec({ type: 'dismiss' })) }
export function refresh(): ActionBuilder { return new ActionBuilder(new ActionSpec({ type: 'refresh' })) }
export function openURL(link: string): ActionBuilder { return new ActionBuilder(new ActionSpec({ type: 'openURL', link })) }

// MARK: - Screen

export interface ScreenOptions {
  schemaVersion?: string
  load?: LoadRequest[]
  variants?: { compact?: NodeBuilder; wide?: NodeBuilder }
}

/// A screen authored in the DSL: validate it, encode it.
export class ScreenBuilder {
  readonly payload: SduiPayload

  constructor(key: string, root: NodeBuilder | SduiNode, options: ScreenOptions = {}) {
    const node = (n: NodeBuilder | SduiNode) => (n instanceof SduiNode ? n : n.node())
    this.payload = new SduiPayload(options.schemaVersion ?? SPEC_VERSION, new ScreenSpec(key, node(root), {
      load: options.load,
      variants: { compact: options.variants?.compact?.node(), wide: options.variants?.wide?.node() }
    }))
  }

  /// Throws `SduiError` if the payload breaks the schema or the bounds.
  validated(validator: SchemaValidator = new SchemaValidator()): this {
    validator.validate(this.payload)
    return this
  }

  /// The payload as a plain JSON object.
  toJSON(): unknown {
    return JSON.parse(this.toString())
  }

  /// Stable JSON text (sorted keys).
  toString(): string {
    return sortedJSONStringify(this.payload)
  }
}

export function screen(key: string, root: NodeBuilder | SduiNode, options: ScreenOptions = {}): ScreenBuilder {
  return new ScreenBuilder(key, root, options)
}
