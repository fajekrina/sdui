// Review diff (HLD Target F5): what a draft changes against a baseline (the active
// release), for maker-checker review. Pure — no DOM; the Studio renders the result.

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved'

export interface ScreenChange {
  kind: ChangeKind
  /// `screen` for screen-level fields, else a node path: `#id` for nodes with an explicit
  /// id, otherwise `<parent path>/<type>[n]` (n-th child of that type), so inserting a
  /// node of another type does not mark its siblings as changed
  path: string
  /// node type, for labels
  type?: string
  /// what changed on that node / screen: `type`, `props.<name>`, `action`, `parent`,
  /// `order`, or screen-level `key` / `load` / `variants`
  field?: string
  before?: unknown
  after?: unknown
}

interface Flat { path: string; type: string; props: Record<string, unknown>; action?: unknown; parent: string; index: number }

type Json = Record<string, unknown>

/// Changes from `base` to `next`. Both are spec payloads (`{ schemaVersion, screen }`) or
/// bare screens (`{ key, root, … }`); `base` may be undefined (a new screen: all added).
export function diff(base: unknown, next: unknown): ScreenChange[] {
  const a = screenOf(base)
  const b = screenOf(next)
  const changes: ScreenChange[] = []
  for (const field of ['key', 'load', 'variants'] as const) {
    if (!a && field !== 'key') continue
    const before = a?.[field]
    const after = b?.[field]
    if (!same(before, after)) changes.push({ kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed', path: 'screen', field, before, after })
  }
  const left = flatten(a?.root)
  const right = flatten(b?.root)
  for (const [path, node] of right) {
    const old = left.get(path)
    if (!old) { changes.push({ kind: 'added', path, type: node.type }); continue }
    if (old.type !== node.type) changes.push({ kind: 'changed', path, type: node.type, field: 'type', before: old.type, after: node.type })
    for (const name of new Set([...Object.keys(old.props), ...Object.keys(node.props)])) {
      const before = old.props[name]
      const after = node.props[name]
      if (!same(before, after)) changes.push({ kind: 'changed', path, type: node.type, field: `props.${name}`, before, after })
    }
    if (!same(old.action, node.action)) changes.push({ kind: 'changed', path, type: node.type, field: 'action', before: old.action, after: node.action })
    if (old.parent !== node.parent) changes.push({ kind: 'moved', path, type: node.type, field: 'parent', before: old.parent, after: node.parent })
    else if (old.index !== node.index && path.startsWith('#')) changes.push({ kind: 'moved', path, type: node.type, field: 'order', before: old.index, after: node.index })
  }
  for (const [path, node] of left) if (!right.has(path)) changes.push({ kind: 'removed', path, type: node.type })
  return changes
}

function screenOf(value: unknown): Json | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Json
  return (v.screen && typeof v.screen === 'object' ? v.screen : v) as Json
}

function flatten(root: unknown): Map<string, Flat> {
  const out = new Map<string, Flat>()
  const walk = (node: unknown, parent: string, index: number, path: string) => {
    if (!node || typeof node !== 'object') return
    const n = node as Json
    const type = String(n.type)
    const key = typeof n.id === 'string' && n.id ? `#${n.id}` : path
    out.set(key, { path: key, type, props: (n.props ?? {}) as Record<string, unknown>, action: n.action, parent, index })
    const seen = new Map<string, number>()
    ;((n.children ?? []) as unknown[]).forEach((child, i) => {
      const childType = String((child as Json)?.type)
      const nth = seen.get(childType) ?? 0
      seen.set(childType, nth + 1)
      walk(child, key, i, `${key}/${childType}[${nth}]`)
    })
  }
  walk(root, '', 0, 'root')
  return out
}

/// structural equality, key order ignored
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Json)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
