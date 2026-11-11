import { SduiNode, type ActionSpec, type SduiProps } from '../core'

// Pure tree transforms keyed by node id — every editor change is one of these.

const GENERATED = /^n_[0-9a-f]{8}$/

/// A fresh editor id (stripped again on export).
export function newId(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return `n_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function isGeneratedId(id: string | undefined): boolean {
  return id !== undefined && GENERATED.test(id)
}

export function withChildren(node: SduiNode, children: SduiNode[]): SduiNode {
  return new SduiNode({ id: node.id, type: node.type, props: node.props, children, action: node.action })
}

export function withProps(node: SduiNode, props: SduiProps): SduiNode {
  return new SduiNode({ id: node.id, type: node.type, props, children: node.children, action: node.action })
}

export function withAction(node: SduiNode, action: ActionSpec | undefined): SduiNode {
  return new SduiNode({ id: node.id, type: node.type, props: node.props, children: node.children, action })
}

/// The node with this id, searching self and descendants.
export function find(node: SduiNode, id: string): SduiNode | undefined {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = find(child, id)
    if (found) return found
  }
  return undefined
}

/// The parent of the node with this id.
export function parentOf(node: SduiNode, id: string): SduiNode | undefined {
  if (node.children.some((c) => c.id === id)) return node
  for (const child of node.children) {
    const found = parentOf(child, id)
    if (found) return found
  }
  return undefined
}

export function replacing(node: SduiNode, id: string, replacement: SduiNode): SduiNode {
  if (node.id === id) return replacement
  return withChildren(node, node.children.map((c) => replacing(c, id, replacement)))
}

export function removing(node: SduiNode, id: string): SduiNode {
  return withChildren(node, node.children.filter((c) => c.id !== id).map((c) => removing(c, id)))
}

/// A copy with `child` inserted into `parentId` at `index` (default: last).
export function insertingChild(node: SduiNode, child: SduiNode, parentId: string, index?: number): SduiNode {
  if (node.id === parentId) {
    const kids = [...node.children]
    kids.splice(index === undefined ? kids.length : Math.max(0, Math.min(index, kids.length)), 0, child)
    return withChildren(node, kids)
  }
  return withChildren(node, node.children.map((c) => insertingChild(c, child, parentId, index)))
}

/// Swap child `id` with the sibling `delta` positions away (no-op out of range).
export function movingChild(node: SduiNode, id: string, delta: number): SduiNode {
  const index = node.children.findIndex((c) => c.id === id)
  if (index >= 0) {
    const target = index + delta
    if (target < 0 || target >= node.children.length) return node
    const moved = [...node.children]
    ;[moved[index], moved[target]] = [moved[target]!, moved[index]!]
    return withChildren(node, moved)
  }
  return withChildren(node, node.children.map((c) => movingChild(c, id, delta)))
}

/// Every node gets an id: existing ids are kept, missing ones are generated.
export function withEnsuredIds(node: SduiNode): SduiNode {
  return new SduiNode({ id: node.id ?? newId(), type: node.type, props: node.props, children: node.children.map(withEnsuredIds), action: node.action })
}

/// A deep copy with fresh generated ids (duplicate).
export function cloningWithNewIds(node: SduiNode): SduiNode {
  return new SduiNode({ id: newId(), type: node.type, props: node.props, children: node.children.map(cloningWithNewIds), action: node.action })
}

/// Generated editor ids removed (authored ids are kept) — clean exported JSON.
export function strippingGeneratedIds(node: SduiNode): SduiNode {
  return new SduiNode({
    id: isGeneratedId(node.id) ? undefined : node.id, type: node.type, props: node.props,
    children: node.children.map(strippingGeneratedIds), action: node.action
  })
}

/// Depth-first list of `[node, depth]` (outline order).
export function flatten(node: SduiNode, depth = 0, out: Array<[SduiNode, number]> = []): Array<[SduiNode, number]> {
  out.push([node, depth])
  for (const child of node.children) flatten(child, depth + 1, out)
  return out
}

/// A short label for an outline row.
export function outlineLabel(node: SduiNode): string {
  switch (node.type) {
    case 'text': return `text: ${node.string('value')}`
    case 'button': return `button: ${node.string('title')}`
    case 'textField':
    case 'textArea':
    case 'picker': return `${node.type}: ${node.string('name')}`
    default: return node.type
  }
}
