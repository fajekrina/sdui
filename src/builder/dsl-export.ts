import type { ActionSpec, SduiNode, SduiPayload, SduiValue } from '../core'

// DSL export — the DSL in reverse: given a payload or node, generate DSL source
// that rebuilds an equivalent tree (generated editor ids are not emitted).
// Every node has a typed builder or `component(…)`, and `.action(…)` carries
// actions on any node, so the export is lossless.

const CONTAINERS = new Set(['vstack', 'hstack', 'zstack', 'card', 'grid', 'scroll', 'form'])
const LEAVES = new Set(['image', 'spacer', 'textField', 'textArea', 'picker'])

export const DSLExport = {
  source(payload: SduiPayload): string {
    const screen = payload.screen
    const opts: string[] = []
    if (payload.schemaVersion !== '1.1') opts.push(`schemaVersion: ${str(payload.schemaVersion)}`)
    if (screen.load.length) opts.push(`load: ${valueLiteral(screen.load.map((l) => (l.params ? { request: l.request, params: l.params } : { request: l.request })) as SduiValue, 1)}`)
    const variants: string[] = []
    if (screen.variants.compact) variants.push(`compact: ${node(screen.variants.compact, 2).trimStart()}`)
    if (screen.variants.wide) variants.push(`wide: ${node(screen.variants.wide, 2).trimStart()}`)
    if (variants.length) opts.push(`variants: {\n${variants.map((v) => `${indent(2)}${v},`).join('\n')}\n${indent(1)}}`)
    const tail = opts.length ? `, {\n${opts.map((o) => `${indent(1)}${o},`).join('\n')}\n}` : ''
    return `screen(${str(screen.key)}, ${node(screen.root, 0).trimStart()}${tail})`
  },

  /// The source for a single node, as an expression.
  node(n: SduiNode): string {
    return node(n, 0)
  }
}

function node(n: SduiNode, level: number): string {
  const pad = indent(level)
  const props: Record<string, SduiValue> = { ...n.props }
  const idCall = n.id !== undefined && !/^n_[0-9a-f]{8}$/.test(n.id) ? `.id(${str(n.id)})` : ''
  const kids = n.children
  let head: string
  if (n.type === 'text' && typeof props.value === 'string') {
    const value = props.value
    delete props.value
    head = `text(${str(value)}${objOrEmpty(props, level)})`
  } else if (n.type === 'button' && typeof props.title === 'string' && kids.length === 0) {
    const title = props.title
    delete props.title
    const action = n.action ? `, ${actionExpr(n.action)}` : Object.keys(props).length ? ', undefined' : ''
    return `${pad}button(${str(title)}${action}${objOrEmpty(props, level)})${idCall}`
  } else if (n.type === 'divider' && Object.keys(props).length === 0 && kids.length === 0) {
    head = 'divider()'
  } else if (n.type === 'list' && typeof props.items === 'string') {
    head = `list(${objectLiteral(props, level)}, ${children(kids, level)})`
  } else if (CONTAINERS.has(n.type)) {
    const parts = [Object.keys(props).length ? objectLiteral(props, level) : '', kids.length ? children(kids, level) : ''].filter(Boolean)
    head = `${n.type}(${parts.join(', ')})`
  } else if (LEAVES.has(n.type) && kids.length === 0) {
    head = `${n.type}(${Object.keys(props).length || n.type === 'image' ? objectLiteral(props, level) : ''})`
  } else {
    const parts = [str(n.type)]
    if (Object.keys(props).length || kids.length) parts.push(objectLiteral(props, level))
    if (kids.length) parts.push(children(kids, level))
    head = `component(${parts.join(', ')})`
  }
  return `${pad}${head}${idCall}${n.action ? `.action(${actionExpr(n.action)})` : ''}`
}

function children(kids: SduiNode[], level: number): string {
  return `[\n${kids.map((k) => `${node(k, level + 1)},`).join('\n')}\n${indent(level)}]`
}

function objOrEmpty(props: Record<string, SduiValue>, level: number): string {
  return Object.keys(props).length ? `, ${objectLiteral(props, level)}` : ''
}

function actionExpr(a: ActionSpec): string {
  const opts: string[] = []
  if (a.presentation) opts.push(`presentation: ${str(a.presentation)}`)
  if (a.level) opts.push(`level: ${str(a.level)}`)
  if (a.params && Object.keys(a.params).length) opts.push(`params: ${objectLiteral(a.params, 0)}`)
  if (a.onSuccess) opts.push(`onSuccess: ${actionExpr(a.onSuccess)}`)
  if (a.onError) opts.push(`onError: ${actionExpr(a.onError)}`)
  const tail = opts.length ? `, { ${opts.join(', ')} }` : ''
  switch (a.type) {
    case 'navigate': return `navigate(${str(a.screen ?? '')}${tail})`
    case 'api': return `api(${str(a.request ?? '')}${tail})`
    case 'native': return `native(${str(a.command ?? '')}${tail})`
    case 'toast': return `toast(${str(a.message ?? '')}${tail})`
    case 'openURL': return `openURL(${str(a.link ?? '')})`
    case 'dismiss': return 'dismiss()'
    case 'refresh': return 'refresh()'
  }
}

function objectLiteral(props: Record<string, SduiValue>, level: number): string {
  const keys = Object.keys(props)
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => `${key(k)}: ${valueLiteral(props[k]!, level)}`).join(', ')} }`
}

function valueLiteral(v: SduiValue, level: number): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return str(v)
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.map((x) => valueLiteral(x, level)).join(', ')}]`
  return objectLiteral(v, level)
}

const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : str(k))
const str = (s: string) => JSON.stringify(s)
const indent = (level: number) => '  '.repeat(level)
