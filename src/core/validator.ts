import { SduiBounds } from './bounds'
import { SduiError } from './errors'
import type { SduiNode } from './node'
import type { SduiPayload } from './payload'
import type { ActionSpec } from './actions/spec'
import type { SduiValue } from './value'

/// Validation layers 2 (schema conformance) and the bounds JSON Schema can't
/// express. Pure — it walks an already-decoded tree (layer 1) and throws
/// `SduiError` on the first violation. Semantic checks (does a `type` resolve,
/// does a `screen`/`request` exist) and the render-time Null-Object fallback are
/// layers 3–4, elsewhere.
///
/// The component `type` vocabulary is OPEN, so this only checks that a type is a
/// well-formed identifier — never that it is registered.
export class SchemaValidator {
  readonly bounds: SduiBounds
  readonly schemaMajor: number

  constructor(init: { bounds?: SduiBounds; schemaMajor?: number } = {}) {
    this.bounds = init.bounds ?? SduiBounds.default
    this.schemaMajor = init.schemaMajor ?? 1
  }

  validate(payload: SduiPayload): void {
    this.validateVersion(payload.schemaVersion)
    const screen = payload.screen
    this.requireIdentifier(screen.key, 'screen.key')
    // One node budget across root and variants: a payload can't multiply its cost.
    const counter = { nodes: 0 }
    this.validateNode(screen.root, 1, counter)
    if (screen.variants.compact) this.validateNode(screen.variants.compact, 1, counter)
    if (screen.variants.wide) this.validateNode(screen.variants.wide, 1, counter)
    if (screen.load.length > this.bounds.maxLoadRequests) {
      throw SduiError.bounds(`load requests exceed ${this.bounds.maxLoadRequests}`)
    }
    for (const load of screen.load) {
      this.requireIdentifier(load.request, 'load.request')
      if (load.params) this.validateParams(load.params)
    }
  }

  /// Validate a node tree without the payload envelope (handy for tests/tools).
  validateRoot(root: SduiNode): void {
    const counter = { nodes: 0 }
    this.validateNode(root, 1, counter)
  }

  // MARK: - Node walk

  private validateNode(node: SduiNode, depth: number, counter: { nodes: number }): void {
    const b = this.bounds
    if (depth > b.maxDepth) throw SduiError.bounds(`tree depth exceeds ${b.maxDepth}`)
    counter.nodes += 1
    if (counter.nodes > b.maxNodes) throw SduiError.bounds(`node count exceeds ${b.maxNodes}`)

    if (!isIdentifier(node.type, true) || length(node.type) > b.maxIdentifierLength) {
      throw SduiError.schema(`invalid component type '${node.type}'`)
    }
    if (node.id !== undefined && length(node.id) > b.maxIdentifierLength) {
      throw SduiError.bounds(`node id length exceeds ${b.maxIdentifierLength}`)
    }

    const props = Object.values(node.props)
    if (props.length > b.maxProps) throw SduiError.bounds(`props exceed ${b.maxProps}`)
    for (const value of props) this.validateValue(value)

    if (node.children.length > b.maxChildren) throw SduiError.bounds(`children exceed ${b.maxChildren}`)
    for (const child of node.children) this.validateNode(child, depth + 1, counter)

    if (node.action) this.validateAction(node.action, 1)
  }

  private validateValue(value: SduiValue): void {
    const b = this.bounds
    if (typeof value === 'string') {
      if (length(value) > b.maxStringLength) throw SduiError.bounds(`string length exceeds ${b.maxStringLength}`)
    } else if (Array.isArray(value)) {
      if (value.length > b.maxArrayItems) throw SduiError.bounds(`array items exceed ${b.maxArrayItems}`)
      for (const element of value) this.validateValue(element)
    } else if (value !== null && typeof value === 'object') {
      const values = Object.values(value)
      if (values.length > b.maxProps) throw SduiError.bounds(`object props exceed ${b.maxProps}`)
      for (const element of values) this.validateValue(element)
    }
  }

  private validateAction(action: ActionSpec, chainDepth: number): void {
    const b = this.bounds
    if (chainDepth > b.maxChainDepth) throw SduiError.bounds(`action chain depth exceeds ${b.maxChainDepth}`)
    switch (action.type) {
      case 'navigate': this.requireNamedTarget(action.screen, 'navigate.screen'); break
      case 'api': this.requireNamedTarget(action.request, 'api.request'); break
      case 'openURL': this.requireNamedTarget(action.link, 'openURL.link'); break
      case 'native': this.requireNamedTarget(action.command, 'native.command'); break
      case 'toast':
        if (action.message === undefined) throw SduiError.schema('toast.message is required')
        this.validateValue(action.message)
        break
      case 'dismiss':
      case 'refresh': break
    }
    if (action.params) this.validateParams(action.params)
    if (action.onSuccess) this.validateAction(action.onSuccess, chainDepth + 1)
    if (action.onError) this.validateAction(action.onError, chainDepth + 1)
  }

  private validateParams(params: Record<string, SduiValue>): void {
    const values = Object.values(params)
    if (values.length > this.bounds.maxProps) throw SduiError.bounds(`params exceed ${this.bounds.maxProps}`)
    for (const value of values) this.validateValue(value)
  }

  // MARK: - Conformance helpers

  private validateVersion(version: string): void {
    const parts = version.split('.')
    const isInt = (s: string) => /^[+-]?\d+$/.test(s)
    if (parts.length !== 2 || !isInt(parts[0]!) || !isInt(parts[1]!)) {
      throw SduiError.schema(`schemaVersion must be MAJOR.MINOR, got '${version}'`)
    }
    if (Number(parts[0]) !== this.schemaMajor) throw SduiError.unsupportedVersion(version)
  }

  private requireNamedTarget(value: string | undefined, label: string): void {
    if (value === undefined) throw SduiError.schema(`${label} is required`)
    this.requireIdentifier(value, label)
  }

  private requireIdentifier(value: string, label: string): void {
    if (!isIdentifier(value) || length(value) > this.bounds.maxIdentifierLength) {
      throw SduiError.schema(`invalid identifier for ${label}: '${value}'`)
    }
  }
}

/// Mirrors the schema patterns: `^[A-Za-z][A-Za-z0-9_]*$` (dots allowed for
/// namespaced component types). ASCII only — rejects URLs, paths, injection.
function isIdentifier(value: string, allowDot = false): boolean {
  return (allowDot ? /^[A-Za-z][A-Za-z0-9_.]*$/ : /^[A-Za-z][A-Za-z0-9_]*$/).test(value)
}

/// Length in Unicode code points (not UTF-16 units), so one emoji counts once.
function length(value: string): number {
  let n = 0
  for (const _ of value) n++
  return n
}
