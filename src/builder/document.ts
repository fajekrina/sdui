import {
  ActionSpec, ComponentFactory, SchemaValidator, SduiError, SduiNode, SduiPayload, ScreenSpec, SPEC_VERSION,
  parseJSON, sortedJSONStringify, type BytesLike, type LoadRequest, type SduiProps
} from '../core'
import { fromUniversal } from '../compat'
import {
  cloningWithNewIds, find, insertingChild, movingChild, parentOf, removing, replacing, strippingGeneratedIds,
  withAction, withEnsuredIds, withProps
} from './tree'
import { DSLExport } from './dsl-export'

export interface ValidationIssue {
  message: string
}

/// The editable screen: a spec node tree where every node has an id, the
/// selection, `screen.load`, and undo history. Views subscribe and call its edit
/// methods; every edit is a pure tree transform.
export class EditorDocument {
  private _key: string
  private _root: SduiNode
  private _load: LoadRequest[]
  private _selection?: string
  private undoStack: Array<{ root: SduiNode; load: LoadRequest[]; key: string }> = []
  private redoStack: Array<{ root: SduiNode; load: LoadRequest[]; key: string }> = []
  private readonly listeners = new Set<() => void>()
  /// warnings from the last legacy import (`fromUniversal`)
  importWarnings: string[] = []

  constructor(init: { key?: string; root?: SduiNode; load?: LoadRequest[]; factory?: ComponentFactory } = {}) {
    this.factory = init.factory ?? ComponentFactory.withBuiltins()
    this._key = init.key ?? 'screen'
    this._root = withEnsuredIds(init.root ?? new SduiNode({ type: 'vstack', props: { spacing: 12, alignment: 'leading', padding: 16 } }))
    this._load = init.load ?? []
  }

  readonly factory: ComponentFactory

  get key(): string { return this._key }
  get root(): SduiNode { return this._root }
  get load(): LoadRequest[] { return this._load }
  get selection(): string | undefined { return this._selection }
  get selected(): SduiNode | undefined { return this._selection ? find(this._root, this._selection) : undefined }

  select(id: string | undefined): void {
    if (this._selection === id) return
    this._selection = id
    this.changed()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private snapshot() { return { root: this._root, load: this._load, key: this._key } }

  private mutate(next: { root?: SduiNode; load?: LoadRequest[]; key?: string }): void {
    const root = next.root ?? this._root
    const load = next.load ?? this._load
    const key = next.key ?? this._key
    // a no-op edit must not touch undo/redo history
    if (root.equals(this._root) && JSON.stringify(load) === JSON.stringify(this._load) && key === this._key) return
    this.undoStack.push(this.snapshot())
    this.redoStack = []
    this._root = root
    this._load = load
    this._key = key
    this.changed()
  }

  /// Where a palette insert goes: into the selected container, else beside the
  /// selected node, else the root.
  insertionPoint(): { parentId: string; index?: number } {
    const sel = this.selected
    if (sel && this.factory.info(sel.type)?.acceptsChildren) return { parentId: sel.id! }
    if (sel) {
      const parent = parentOf(this._root, sel.id!)
      if (parent) return { parentId: parent.id!, index: parent.children.findIndex((c) => c.id === sel.id) + 1 }
    }
    return { parentId: this._root.id! }
  }

  /// Insert a new component of `type` (with its palette default props).
  add(type: string, at = this.insertionPoint()): string {
    const info = this.factory.info(type)
    const node = withEnsuredIds(new SduiNode({ type, props: { ...(info?.defaultProps ?? {}) } as SduiProps }))
    this.insert(node, at.parentId, at.index)
    this.select(node.id)
    return node.id!
  }

  insert(child: SduiNode, parentId: string, index?: number): void {
    this.mutate({ root: insertingChild(this._root, withEnsuredIds(child), parentId, index) })
  }

  /// Can the node with this id hold children (its component `acceptsChildren`)?
  isContainer(id: string): boolean {
    const node = find(this._root, id)
    return !!node && this.factory.info(node.type)?.acceptsChildren === true
  }

  /// Where a drop relative to `targetId` lands: `inside` a container (last
  /// child), or `before`/`after` it among its siblings. `undefined` when the
  /// drop is not possible (e.g. inside a leaf, or beside the root).
  placement(targetId: string, where: 'inside' | 'before' | 'after'): { parentId: string; index?: number } | undefined {
    if (where === 'inside') return this.isContainer(targetId) ? { parentId: targetId } : undefined
    const parent = parentOf(this._root, targetId)
    if (!parent) return undefined
    const index = parent.children.findIndex((c) => c.id === targetId)
    return { parentId: parent.id!, index: where === 'before' ? index : index + 1 }
  }

  /// Containers `id` may move into: every container except the node itself and
  /// its descendants (parent picker).
  parentCandidates(id: string): SduiNode[] {
    const node = find(this._root, id)
    if (!node || id === this._root.id) return []
    const out: SduiNode[] = []
    const walk = (n: SduiNode) => {
      if (n.id === id) return
      if (this.factory.info(n.type)?.acceptsChildren) out.push(n)
      n.children.forEach(walk)
    }
    walk(this._root)
    return out
  }

  /// Move node `id` into container `parentId` at `index` (default: last).
  /// Refuses the root, a non-container parent, and a parent inside the moved
  /// node; returns whether the tree changed.
  reparent(id: string, parentId: string, index?: number): boolean {
    const node = find(this._root, id)
    if (!node || id === this._root.id || !this.isContainer(parentId) || find(node, parentId)) return false
    const from = parentOf(this._root, id)!
    const oldIndex = from.children.findIndex((c) => c.id === id)
    // removing the node first shifts later siblings of the same parent up by one
    const target = index !== undefined && from.id === parentId && oldIndex < index ? index - 1 : index
    const before = this._root
    this.mutate({ root: insertingChild(removing(this._root, id), node, parentId, target) })
    return this._root !== before
  }

  delete(id: string): void {
    if (id === this._root.id) return
    this.mutate({ root: removing(this._root, id) })
    if (this._selection === id) this.select(undefined)
  }

  duplicate(id: string): void {
    const node = find(this._root, id)
    const parent = parentOf(this._root, id)
    if (!node || !parent) return
    const copy = cloningWithNewIds(node)
    this.insert(copy, parent.id!, parent.children.findIndex((c) => c.id === id) + 1)
    this.select(copy.id)
  }

  move(id: string, delta: number): void { this.mutate({ root: movingChild(this._root, id, delta) }) }
  replace(id: string, node: SduiNode): void { this.mutate({ root: replacing(this._root, id, node) }) }

  setProp(id: string, key: string, value: SduiProps[string] | undefined): void {
    const node = find(this._root, id)
    if (!node) return
    const props = { ...node.props }
    if (value === undefined || value === '') delete props[key]
    else props[key] = value
    this.replace(id, withProps(node, props))
  }

  setProps(id: string, props: SduiProps): void {
    const node = find(this._root, id)
    if (node) this.replace(id, withProps(node, props))
  }

  setAction(id: string, action: ActionSpec | undefined): void {
    const node = find(this._root, id)
    if (node) this.replace(id, withAction(node, action))
  }

  setKey(key: string): void { this.mutate({ key }) }
  setLoad(load: LoadRequest[]): void { this.mutate({ load }) }

  /// The payload (generated ids stripped).
  payload(): SduiPayload {
    return new SduiPayload(SPEC_VERSION, new ScreenSpec(this._key, strippingGeneratedIds(this._root), { load: this._load }))
  }

  /// Validation issues for the current tree (empty = valid).
  issues(validator: SchemaValidator = new SchemaValidator()): ValidationIssue[] {
    try {
      validator.validate(this.payload())
      return []
    } catch (error) {
      return [{ message: error instanceof Error ? error.message : String(error) }]
    }
  }

  /// Replace the document with a spec payload — or a legacy UniversalPageConfig,
  /// converted with `fromUniversal` (its warnings land in `importWarnings`).
  importJSON(data: BytesLike | object): void {
    const raw = typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer) ? data : parseJSON(data as BytesLike)
    let payload: SduiPayload
    const obj = raw as Record<string, unknown>
    if (obj && typeof obj === 'object' && 'screen' in obj) {
      payload = SduiPayload.decode(raw)
      this.importWarnings = []
    } else if (obj && typeof obj === 'object' && ('layout' in obj || 'components' in obj || Array.isArray(raw))) {
      const converted = fromUniversal(raw)
      payload = SduiPayload.decode(converted.payload)
      this.importWarnings = converted.warnings
    } else {
      throw SduiError.decode('not a spec payload or a legacy page')
    }
    this.undoStack.push(this.snapshot())
    this.redoStack = []
    this._key = payload.screen.key
    this._root = withEnsuredIds(payload.screen.root)
    this._load = payload.screen.load
    this._selection = undefined
    this.changed()
  }

  /// Validated JSON (sorted keys, generated ids stripped). Throws on invalid.
  exportJSON(validator: SchemaValidator = new SchemaValidator()): string {
    const payload = this.payload()
    validator.validate(payload)
    return sortedJSONStringify(payload)
  }

  /// DSL (TypeScript) source that rebuilds this screen.
  exportDSL(): string {
    return DSLExport.source(this.payload())
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  undo(): void {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.snapshot())
    ;({ root: this._root, load: this._load, key: this._key } = previous)
    this.changed()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.snapshot())
    ;({ root: this._root, load: this._load, key: this._key } = next)
    this.changed()
  }
}
