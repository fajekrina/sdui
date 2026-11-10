/**
 * Fajrina SDUI — Actions: one place that reads an action off a component.
 *
 * Adapters used to re-implement alias resolution (props.action string, url,
 * props.behavior, ...) twice. resolveAction() normalizes every accepted shape
 * into one ResolvedAction and reports legacy shapes so they can be removed in 1.0.
 */

import type { UniversalComponent } from './types'
import type { SduiPolicy } from './validate'

export interface ResolvedAction {
  behavior: string
  target?: string
  href?: string
  modalId?: string
  title?: string
  message?: string
  eventName?: string
  params?: Record<string, unknown>
  /** `api` action */
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  onSuccess?: ResolvedAction
  onError?: ResolvedAction
  /** legacy alias names that were used (empty = official shape) */
  legacy: string[]
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v))

function fromObject(obj: Obj, legacy: string[], depth: number): ResolvedAction | null {
  let behavior = str(obj.behavior)
  if (!behavior && str(obj.action)) { behavior = str(obj.action); legacy.push('action.action') }
  if (!behavior) return null
  let href = str(obj.href)
  if (!href && str(obj.url) && behavior !== 'api') { href = str(obj.url); legacy.push('action.url') }
  const method = str(obj.method)?.toUpperCase()
  const out: ResolvedAction = {
    behavior,
    target: str(obj.target),
    href,
    modalId: str(obj.modalId),
    title: str(obj.title),
    message: str(obj.message),
    eventName: str(obj.eventName),
    params: isObj(obj.params) ? obj.params : undefined,
    url: behavior === 'api' ? str(obj.url) : undefined,
    method: method === 'GET' || method === 'POST' || method === 'PUT' || method === 'DELETE' ? method : undefined,
    body: obj.body,
    legacy
  }
  // chains are linear and bounded; deeper levels are dropped (validate reports them)
  if (depth < 8) {
    if (isObj(obj.onSuccess)) out.onSuccess = fromObject(obj.onSuccess, [], depth + 1) ?? undefined
    if (isObj(obj.onError)) out.onError = fromObject(obj.onError, [], depth + 1) ?? undefined
  }
  return out
}

/**
 * Normalize the action of a component. Accepted, in priority order:
 *   props.action {…}   (official)
 *   comp.action {…}    (official, builder keeps both in sync)
 *   props.action "x"   (legacy) · props.behavior (legacy) · url / action.action aliases (legacy)
 */
export function resolveAction(comp: UniversalComponent): ResolvedAction | null {
  const props = (comp.props ?? {}) as Obj
  const legacy: string[] = []
  const merged: Obj = {}
  const top = isObj(comp.action) ? (comp.action as unknown as Obj) : undefined
  const inProps = isObj(props.action) ? props.action : undefined
  if (top) Object.assign(merged, top)
  if (inProps) Object.assign(merged, inProps)
  if (!inProps && !top) {
    if (typeof props.action === 'string' && props.action) { merged.behavior = props.action; legacy.push('props.action (string)') }
    else if (typeof props.behavior === 'string' && props.behavior) { merged.behavior = props.behavior; legacy.push('props.behavior') }
    else return null
  }
  // legacy fallbacks read from props when the action object lacks them
  if (merged.target == null && props.target != null && !inProps) merged.target = props.target
  if (merged.href == null && merged.url == null) {
    if (props.href != null && (merged.behavior === 'externalLink')) merged.href = props.href
    else if (props.url != null) { merged.href = props.url; legacy.push('props.url') }
  }
  if (merged.params == null && isObj(props.params)) merged.params = props.params
  if (merged.message == null && merged.behavior === 'toast' && (props.message != null || props.content != null)) merged.message = props.message ?? props.content
  if (merged.eventName == null && props.eventName != null) merged.eventName = props.eventName
  if (merged.modalId == null && merged.behavior === 'openModal' && props.target != null) merged.modalId = props.target
  return fromObject(merged, legacy, 0)
}

/** Depth of an onSuccess/onError chain (1 = single action). */
export function chainDepth(action: ResolvedAction | null | undefined): number {
  if (!action) return 0
  return 1 + Math.max(chainDepth(action.onSuccess), chainDepth(action.onError))
}

// ---------------------------------------------------------------------------
// Policy helpers (shared by validate, view-model and dispatcher)
// ---------------------------------------------------------------------------

export function hostMatches(host: string, entry: string): boolean {
  const rule = entry.trim().toLowerCase().replace(/^\*\./, '')
  if (!rule) return false
  return host === rule || host.endsWith(`.${rule}`)
}

export type UrlCheck = { ok: true; kind: 'web' | 'relative' | 'scheme' } | { ok: false; reason: string }

const SAFE_SCHEMES = new Set(['mailto', 'tel'])

/**
 * Classify a URL for links/redirects. http(s) hosts must be allow-listed when
 * the policy defines allowedDomains; relative paths, `#` and mailto/tel pass;
 * anything else (javascript:, data:, …) is rejected.
 */
export function checkUrl(href: string | undefined, policy?: SduiPolicy): UrlCheck {
  if (!href) return { ok: false, reason: 'empty url' }
  const value = href.trim()
  if (value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('?')) {
    return { ok: true, kind: 'relative' }
  }
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)
  if (!m) return { ok: true, kind: 'relative' }
  const scheme = m[1]!.toLowerCase()
  if (SAFE_SCHEMES.has(scheme)) return { ok: true, kind: 'scheme' }
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: `scheme '${scheme}' not allowed` }
  let host = ''
  try { host = new URL(value).hostname.toLowerCase() } catch { return { ok: false, reason: 'unparseable url' } }
  if (!host) return { ok: false, reason: 'missing host' }
  if (policy?.allowedDomains && !policy.allowedDomains.some((d) => hostMatches(host, d))) {
    return { ok: false, reason: `host '${host}' not in policy allowedDomains` }
  }
  return { ok: true, kind: 'web' }
}

/** Image sources: scheme check only (CDNs vary; domain policy governs navigation, not media). */
export function checkMediaUrl(src: string | undefined): boolean {
  if (!src) return false
  const value = src.trim()
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)
  if (!m) return true
  const scheme = m[1]!.toLowerCase()
  if (scheme === 'http' || scheme === 'https') return true
  return scheme === 'data' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value)
}

/**
 * Effective policy: the app-supplied policy is the upper bound; the payload
 * policy (from the network) may only narrow it.
 */
export function mergePolicy(appPolicy?: SduiPolicy, payloadPolicy?: SduiPolicy): SduiPolicy | undefined {
  if (!appPolicy) return payloadPolicy
  if (!payloadPolicy) return appPolicy
  const narrow = (app?: string[], payload?: string[]): string[] | undefined => {
    if (!app) return payload
    if (!payload) return app
    return app.filter((x) => payload.includes(x))
  }
  return {
    ...payloadPolicy,
    ...appPolicy,
    allowedDomains: narrow(appPolicy.allowedDomains, payloadPolicy.allowedDomains),
    allowedEvents: narrow(appPolicy.allowedEvents, payloadPolicy.allowedEvents)
  }
}

// ---------------------------------------------------------------------------
// Form field validation (shared by every adapter)
// ---------------------------------------------------------------------------

export interface FieldRule {
  name: string
  label?: string
  required?: boolean
  minLength?: number
  maxLength?: number
  type?: string
  validation?: Array<{ rule?: string; message?: string; value?: unknown }>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateField(rule: FieldRule, raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  const label = rule.label ?? rule.name
  if (rule.required && !value) return `${label} wajib diisi`
  if (!value) return null
  if (rule.minLength != null && value.length < rule.minLength) return `${label} minimal ${rule.minLength} karakter`
  if (rule.maxLength != null && value.length > rule.maxLength) return `${label} maksimal ${rule.maxLength} karakter`
  if (rule.type === 'email' && !EMAIL.test(value)) return `${label} tidak valid`
  for (const v of rule.validation ?? []) {
    if (v.rule === 'email' && !EMAIL.test(value)) return v.message ?? `${label} tidak valid`
    if (v.rule === 'pattern' && typeof v.value === 'string') {
      try { if (!new RegExp(v.value).test(value)) return v.message ?? `${label} tidak valid` } catch { /* bad pattern: ignore */ }
    }
  }
  return null
}
