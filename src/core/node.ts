import { SduiError } from './errors'
import { SduiValue, type SduiProps } from './value'
import { ActionSpec, canonical, optionalString } from './actions/spec'

export interface SduiNodeInit {
  id?: string
  type: string
  props?: SduiProps
  children?: SduiNode[]
  action?: ActionSpec
}

/// A decoded UI node — the Composite element the renderer walks.
///
/// `type` is an OPEN vocabulary: the component registry is extensible, so the
/// model accepts any type string. Whether it resolves to a real component is a
/// semantic / render-time concern, not a decode concern.
///
/// `id` is optional in the JSON; the renderer keys children by `id ?? position`,
/// so the data model never fabricates one.
export class SduiNode {
  readonly id?: string
  readonly type: string
  readonly props: SduiProps
  readonly children: SduiNode[]
  readonly action?: ActionSpec

  constructor(init: SduiNodeInit) {
    if (init.id !== undefined) this.id = init.id
    this.type = init.type
    this.props = init.props ?? {}
    this.children = init.children ?? []
    if (init.action !== undefined) this.action = init.action
  }

  /// Structural decode: `type` is required; `props`/`children` default to empty;
  /// unknown keys are ignored.
  static decode(raw: unknown, path = 'node'): SduiNode {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw SduiError.decode(`${path}: expected an object`)
    const o = raw as Record<string, unknown>
    if (typeof o.type !== 'string') throw SduiError.decode(`${path}.type: required string is missing`)
    let children: SduiNode[] = []
    if (o.children != null) {
      if (!Array.isArray(o.children)) throw SduiError.decode(`${path}.children: expected an array`)
      children = o.children.map((child, i) => SduiNode.decode(child, `${path}.children[${i}]`))
    }
    return new SduiNode({
      id: optionalString(o.id, `${path}.id`),
      type: o.type,
      props: o.props == null ? {} : SduiValue.decodeObject(o.props, `${path}.props`),
      children,
      action: o.action == null ? undefined : ActionSpec.decode(o.action, `${path}.action`)
    })
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (this.id !== undefined) out.id = this.id
    out.type = this.type
    if (Object.keys(this.props).length > 0) out.props = this.props
    if (this.children.length > 0) out.children = this.children.map((c) => c.toJSON())
    if (this.action !== undefined) out.action = this.action.toJSON()
    return out
  }

  equals(other: SduiNode | undefined): boolean {
    return !!other && JSON.stringify(canonical(this.toJSON())) === JSON.stringify(canonical(other.toJSON()))
  }

  // MARK: - Typed prop accessors (defaulting; never throw)

  value(key: string): SduiValue | undefined { return this.props[key] }
  string(key: string): string { return SduiValue.stringValue(this.props[key]) ?? '' }
  int(key: string): number { return SduiValue.intValue(this.props[key]) ?? 0 }
  double(key: string): number { return SduiValue.doubleValue(this.props[key]) ?? 0 }
  bool(key: string): boolean { return SduiValue.boolValue(this.props[key]) ?? false }
  array(key: string): SduiValue[] { return SduiValue.arrayValue(this.props[key]) ?? [] }
}
