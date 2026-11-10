/**
 * Fajrina SDUI — Validation (warn-first by default, strict when asked).
 * Port of MurtiBounds + MurtiSchemaValidator semantics (ASCII-ish identifiers,
 * recursion limits, required action targets, allow-listed links/events),
 * plus schemaVersion and policy envelopes. validateLayout() and validateData()
 * never throw; adapters decide warn vs fail-closed via ValidateOptions.mode.
 */

import type { FajrinaData, UniversalComponent, UniversalLayout } from './types'
import { normalizeToLayout, getComponentType } from './types'
import { validateDistanceProps } from './style'
import type { UniversalTheme } from './theme'
import { resolveAction, chainDepth, checkUrl, mergePolicy, type ResolvedAction } from './actions'
import { BEHAVIORS, getDescriptor } from './registry'

export type SduiErrorCode =
  | 'decode'
  | 'schema'
  | 'unsupportedVersion'
  | 'unknownType'
  | 'unknownAction'
  | 'unlistedDomain'
  | 'unlistedEvent'
  | 'bounds'
  | 'network' // transport failure: offline, DNS, CORS, aborted, no NetworkPort
  | 'http'    // the server answered with a non-2xx status (see status / serverCode)

export interface SduiError {
  code: SduiErrorCode
  message: string
  /** component id or JSON path, when known */
  path?: string
  /** HTTP status of the failed response (code 'http') */
  status?: number
  /** backend error code, e.g. universal-service `errorCode: "SDUI-002"` */
  serverCode?: string
}

export interface SduiBounds {
  maxDepth: number
  maxNodes: number
  maxStringLength: number
  maxProps: number
  maxChildren: number
  maxArrayItems: number
  maxIdentifierLength: number
  /** onSuccess/onError chain depth (1 = single action) */
  maxChainDepth?: number
}

/**
 * Per-merchant policy, supplied by the backend alongside the payload.
 * Absent policy = silent (backward compatible): no domain/event warnings.
 * Mirrors the policy block proposed for multi-vendor CMS enforcement.
 */
export interface SduiPolicy {
  merchantId?: string
  policyVersion?: string
  allowedDomains?: string[]
  allowedEvents?: string[]
}

export interface ValidateOptions {
  bounds?: SduiBounds
  policy?: SduiPolicy
  theme?: UniversalTheme
  /** warn = log only (default, backward compatible); strict = caller should fail closed. */
  mode?: 'warn' | 'strict'
}

function normalizeOptions(boundsOrOpts?: SduiBounds | ValidateOptions): { bounds: SduiBounds; policy?: SduiPolicy; theme?: UniversalTheme; mode: 'warn' | 'strict' } {
  if (!boundsOrOpts) return { bounds: DEFAULT_BOUNDS, mode: 'warn' }
  if ((boundsOrOpts as SduiBounds).maxDepth != null) return { bounds: boundsOrOpts as SduiBounds, mode: 'warn' }
  const opts = boundsOrOpts as ValidateOptions
  return { bounds: opts.bounds ?? DEFAULT_BOUNDS, policy: opts.policy, theme: opts.theme, mode: opts.mode ?? 'warn' }
}

export const DEFAULT_BOUNDS: SduiBounds = {
  maxDepth: 32,
  maxNodes: 5000,
  maxStringLength: 4096,
  maxProps: 64,
  maxChildren: 256,
  maxArrayItems: 512,
  maxIdentifierLength: 128,
  maxChainDepth: 4
}

/** Known behaviors: closed vocabulary from the component registry. */
const KNOWN_BEHAVIORS: ReadonlySet<string> = new Set<string>(BEHAVIORS)

function isIdentifier(value: string, allowDot: boolean): boolean {
  if (!value) return false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    // NOTE: looser than Murti's ^[A-Za-z]... on purpose — real backends use
    // ULIDs (e.g. 01HQ...) that start with digits. Only shape is enforced.
    const isAlpha = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
    const isDigit = ch >= '0' && ch <= '9'
    if (i === 0) {
      if (!(isAlpha || isDigit)) return false
    } else {
      if (!(isAlpha || isDigit || ch === '_' || ch === '-' || (allowDot && ch === '.'))) return false
    }
  }
  return true
}

function checkString(value: unknown, errors: SduiError[], bounds: SduiBounds, path: string): void {
  if (typeof value === 'string') {
    if (value.length > bounds.maxStringLength) {
      errors.push({ code: 'bounds', message: `string length exceeds ${bounds.maxStringLength}`, path })
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > bounds.maxArrayItems) {
      errors.push({ code: 'bounds', message: `array items exceed ${bounds.maxArrayItems}`, path })
    }
    value.forEach((v, i) => checkString(v, errors, bounds, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      checkString(v, errors, bounds, path ? `${path}.${k}` : k)
    }
  }
}

export function checkSchemaVersion(version: unknown): SduiError[] {
  if (version == null) return []
  const parts = String(version).split('.')
  if (parts.length !== 2 || parts[0] !== '1' || parts[1] === '' || isNaN(parseInt(parts[1]!, 10))) {
    return [{ code: 'unsupportedVersion', message: `schemaVersion must be 1.x, got '${String(version)}'` }]
  }
  return []
}

function checkAction(comp: UniversalComponent, errors: SduiError[], id: string, bounds: SduiBounds, policy?: SduiPolicy): void {
  const action = resolveAction(comp)
  if (!action) return
  const walk = (a: ResolvedAction, depth: number): void => {
    if (!KNOWN_BEHAVIORS.has(a.behavior)) {
      errors.push({ code: 'unknownAction', message: `unknown action behavior '${a.behavior}'`, path: id })
      return
    }
    if (a.behavior === 'navigate' && !a.target) {
      errors.push({ code: 'schema', message: `navigate action requires target`, path: id })
    }
    if (a.behavior === 'openModal' && !a.modalId) {
      errors.push({ code: 'schema', message: `openModal action requires modalId (or target)`, path: id })
    }
    if (a.behavior === 'externalLink') {
      if (!a.href) {
        errors.push({ code: 'schema', message: `externalLink action has unresolvable href`, path: id })
      } else if (policy?.allowedDomains) {
        const check = checkUrl(a.href, policy)
        if (!check.ok) {
          errors.push({ code: check.reason.startsWith('host') ? 'unlistedDomain' : 'schema', message: `externalLink ${check.reason}`, path: id })
        }
      }
    }
    if (a.behavior === 'api') {
      if (!a.url) {
        errors.push({ code: 'schema', message: `api action requires url`, path: id })
      } else {
        const check = checkUrl(a.url, policy)
        if (!check.ok) errors.push({ code: check.reason.startsWith('host') ? 'unlistedDomain' : 'schema', message: `api ${check.reason}`, path: id })
      }
    }
    if (a.behavior === 'customEvent' && policy?.allowedEvents) {
      const name = a.eventName ?? ''
      if (!policy.allowedEvents.includes(name)) {
        errors.push({ code: 'unlistedEvent', message: `customEvent '${name || '(empty)'}' not in policy allowedEvents`, path: id })
      }
    }
    if (a.onSuccess) walk(a.onSuccess, depth + 1)
    if (a.onError) walk(a.onError, depth + 1)
  }
  walk(action, 1)
  const depth = chainDepth(action)
  const max = bounds.maxChainDepth ?? DEFAULT_BOUNDS.maxChainDepth!
  if (depth > max) {
    errors.push({ code: 'bounds', message: `action chain depth ${depth} exceeds ${max}`, path: id })
  }
  const descriptor = getDescriptor(getComponentType(comp))
  if (descriptor && KNOWN_BEHAVIORS.has(action.behavior) && !descriptor.allowedBehaviors.includes(action.behavior)) {
    errors.push({ code: 'unknownAction', message: `${descriptor.type} cannot trigger '${action.behavior}'`, path: id })
  }
}

export function validateLayout(layout: UniversalLayout | null | undefined, boundsOrOpts?: SduiBounds | ValidateOptions): SduiError[] {
  const { bounds, policy } = normalizeOptions(boundsOrOpts);
  const errors: SduiError[] = []
  if (!layout) return errors
  const components = layout.components ?? []

  // Envelope version, when present (MAJOR.MINOR, major 1 supported).
  errors.push(...checkSchemaVersion((layout as unknown as Record<string, unknown>).schemaVersion))

  let nodeCount = 0
  const visited = new Set<string>()
  const walk = (node: UniversalComponent, depth: number, path: string): void => {
    if (depth > bounds.maxDepth) {
      errors.push({ code: 'bounds', message: `tree depth exceeds ${bounds.maxDepth}`, path })
      return
    }
    const key = node.id ?? `${path}`
    if (visited.has(key)) return
    visited.add(key)
    nodeCount += 1
    if (nodeCount > bounds.maxNodes) {
      errors.push({ code: 'bounds', message: `node count exceeds ${bounds.maxNodes}`, path })
      return
    }
    const type = getComponentType(node)
    if (!isIdentifier(type, true) || type.length > bounds.maxIdentifierLength) {
      errors.push({ code: 'schema', message: `invalid component type '${type}'`, path })
    }
    if (node.id != null && (!isIdentifier(node.id, false) || node.id.length > bounds.maxIdentifierLength)) {
      errors.push({ code: 'schema', message: `invalid component id '${node.id}'`, path })
    }
    const props = (node.props ?? {}) as Record<string, unknown>
    if (Object.keys(props).length > bounds.maxProps) {
      errors.push({ code: 'bounds', message: `props exceed ${bounds.maxProps}`, path })
    }
    checkString(props, errors, bounds, path || node.id || 'props')
    checkString(node.style ?? {}, errors, bounds, path || node.id || 'style')
    const children = (node.children ?? []) as UniversalComponent[]
    if (children.length > bounds.maxChildren) {
      errors.push({ code: 'bounds', message: `children exceed ${bounds.maxChildren}`, path })
    }
    for (const e of validateDistanceProps(type, props)) {
      errors.push({ code: 'schema', message: e, path })
    }
    checkAction(node, errors, node.id || path, bounds, policy)
    children.forEach((ch, i) => walk(ch, depth + 1, `${path || node.id || 'root'}.children[${i}]`))
  }
  components.forEach((c, i) => walk(c, 1, `components[${i}]`))
  return errors
}

/**
 * Pure validation entry point: normalize → envelope version → theme lock →
 * layout validation. Never throws (decode failures become SduiErrors).
 * Adapters use this for both warn logging and strict fail-closed rendering.
 */
export function validateData(data: FajrinaData, boundsOrOpts?: SduiBounds | ValidateOptions): SduiError[] {
  const { bounds, policy: explicitPolicy, theme } = normalizeOptions(boundsOrOpts)
  try {
    // the app policy is the upper bound; the payload policy may only narrow it
    let embedded: SduiPolicy | undefined
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const p = (data as Record<string, unknown>).policy
      if (p && typeof p === 'object') embedded = p as SduiPolicy
    }
    const policy = mergePolicy(explicitPolicy, embedded)
    const errors = validateLayout(normalizeToLayout(data), { bounds, policy })
    // normalizeToLayout drops the page envelope — check its version too.
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const e of checkSchemaVersion((data as Record<string, unknown>).schemaVersion)) {
        if (!errors.some((x) => x.code === e.code && x.message === e.message)) errors.push(e)
      }
      // Lock the rendering theme against the payload's required themeVersion.
      const requiredTheme = (data as Record<string, unknown>).policy != null
        ? ((data as Record<string, unknown>).policy as Record<string, unknown>).themeVersion
        : undefined
      if (requiredTheme != null && theme?.version != null && String(theme.version) !== String(requiredTheme)) {
        errors.push({ code: 'schema', message: `theme version mismatch: need ${String(requiredTheme)}, got ${String(theme.version)}` })
      }
    }
    return errors
  } catch (e) {
    return [{ code: 'decode', message: String((e as Error)?.message ?? e) }]
  }
}

/**
 * Validate any FajrinaData and console.warn each issue. Warn-only: never
 * throws, never alters rendering. Call once per data change in adapters.
 */
export function warnValidation(data: FajrinaData, boundsOrOpts?: SduiBounds | ValidateOptions): SduiError[] {
  const errors = validateData(data, boundsOrOpts)
  for (const err of errors) {
    console.warn(`[fajrina-sdui:${err.code}]${err.path ? ` ${err.path}` : ''} — ${err.message}`)
  }
  return errors
}

/** What the fallback error page tells the user (drives its title). */
export type ErrorPageKind = 'notFound' | 'forbidden' | 'rejected' | 'unavailable' | 'offline' | 'invalid' | 'blocked'

const ERROR_TITLES: Record<ErrorPageKind, string> = {
  notFound: 'Not Found',
  forbidden: 'Access Denied',
  rejected: 'Request Rejected',
  unavailable: 'Service Unavailable',
  offline: 'Offline',
  invalid: 'Invalid Page',
  blocked: 'Blocked'
}

/** Map an SduiError to the kind of error page to show. */
export function errorKindOf(err: Pick<SduiError, 'code' | 'status'>): ErrorPageKind {
  if (err.code === 'network') return 'offline'
  if (err.code === 'decode') return 'invalid'
  if (err.code === 'http') {
    const st = err.status ?? 0
    if (st === 404 || st === 410) return 'notFound'
    if (st === 401 || st === 403) return 'forbidden'
    if (st >= 500) return 'unavailable'
    return 'rejected'
  }
  return 'blocked'
}

export interface ErrorPageOptions {
  /** default 'notFound' (0.2.x output) */
  kind?: ErrorPageKind
  code?: SduiErrorCode
  status?: number
  serverCode?: string
}

/**
 * Build the fallback error page rendered when a fetch fails or a page is blocked.
 * `page.error` carries the machine-readable details ({ kind, code, status, serverCode }).
 */
export function toErrorPage(message: string, opts: ErrorPageOptions = {}): import('./types').UniversalPageConfig {
  const kind = opts.kind ?? 'notFound'
  const error: Record<string, unknown> = { kind }
  if (opts.code) error.code = opts.code
  if (opts.status != null) error.status = opts.status
  if (opts.serverCode) error.serverCode = opts.serverCode
  return {
    pageId: 'error',
    pageKey: 'error',
    merchantId: 'system',
    status: 'PUBLISHED',
    error,
    layout: {
      title: ERROR_TITLES[kind],
      subtitle: message,
      components: [{ type: 'Text', id: 'err', props: { content: message }, style: { color: '#ef4444' } }]
    }
  }
}
