// @fajekrina/sdui — compat: `fromUniversal()` converts a legacy UniversalPageConfig
// (0.x format: `layout.components[]`, 18 PascalCase types, free CSS) into the
// spec format. A BUILDER tool for importing old pages — never a runtime path:
// the backend serves the spec format directly.
//
// Lossy by design: free CSS that has no closed style prop is dropped, raw URLs
// become link/asset NAMES the app maps, and every loss is reported per node so a
// designer can fix it.

import { SPEC_VERSION } from '../spec'
import type { SduiProps, SduiValue } from '../core/value'

type Obj = Record<string, unknown>

export interface LegacyComponent {
  id?: string
  type?: string
  component?: string
  parentId?: string | null
  order?: number
  props?: Obj
  style?: Record<string, unknown>
  action?: Obj
  children?: LegacyComponent[]
}

export interface ConversionResult {
  /// spec payload JSON (`{ schemaVersion, screen: { key, root } }`)
  payload: { schemaVersion: string; screen: { key: string; root: SpecNodeJSON } }
  /// one line per lossy decision, prefixed with the legacy node id
  warnings: string[]
}

export interface SpecNodeJSON {
  type: string
  id?: string
  props?: SduiProps
  children?: SpecNodeJSON[]
  action?: SpecActionJSON
}

export interface SpecActionJSON {
  type: string
  screen?: string
  presentation?: string
  request?: string
  link?: string
  message?: string
  level?: string
  params?: SduiProps
  onSuccess?: SpecActionJSON
  onError?: SpecActionJSON
}

/// Reduce a string to a spec identifier (`^[A-Za-z][A-Za-z0-9_]*$`):
/// `seat-selection` → `seat_selection`, `https://help.example.com/faq` → `help_example_com_faq`.
export function toIdentifier(raw: string, fallback = 'item'): string {
  const cleaned = raw.replace(/^[a-z]+:\/\//i, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const start = cleaned.search(/[A-Za-z]/)
  const id = start < 0 ? '' : cleaned.slice(start)
  return (id || fallback).slice(0, 128)
}

const SPACING_TOKENS: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 }

function px(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  if (value in SPACING_TOKENS) return SPACING_TOKENS[value]
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim())
  return m ? Number(m[1]) : undefined
}

function hexColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value.trim()) ? value.trim().toUpperCase() : undefined
}

const WEIGHTS: Record<string, string> = { '100': 'ultralight', '200': 'thin', '300': 'light', '400': 'regular', normal: 'regular', '500': 'medium', '600': 'semibold', '700': 'bold', bold: 'bold', '800': 'heavy', '900': 'black' }

/// CSS keys the converter maps to a closed prop (everything else is reported).
const MAPPED_CSS = new Set([
  'gap', 'padding', 'background', 'backgroundColor', 'borderRadius', 'color', 'fontSize', 'fontWeight',
  'alignItems', 'flexDirection', 'display', 'height'
])

class Converter {
  readonly warnings: string[] = []

  constructor(private readonly pageKey: string) {}

  warn(id: string | undefined, message: string) {
    this.warnings.push(`${id ?? '?'}: ${message}`)
  }

  convert(c: LegacyComponent, form?: { fields: string[]; submit?: Obj }): SpecNodeJSON | null {
    const type = c.type ?? c.component ?? ''
    const props = c.props ?? {}
    const style = c.style ?? {}
    const dropped = Object.keys(style).filter((k) => !MAPPED_CSS.has(k))
    if (dropped.length) this.warn(c.id, `CSS without a style prop dropped: ${dropped.join(', ')}`)

    const shared: SduiProps = {}
    const padding = px(style.padding)
    if (padding !== undefined) shared.padding = padding
    else if (style.padding !== undefined) this.warn(c.id, `padding "${String(style.padding)}" is not a single value; dropped`)
    const background = hexColor(style.backgroundColor ?? style.background)
    if (background) shared.background = background
    const radius = px(style.borderRadius)
    if (radius !== undefined) shared.cornerRadius = radius

    const kids = (f = form) => (c.children ?? []).map((k) => this.convert(k, f)).filter((n): n is SpecNodeJSON => n !== null)
    const node = (specType: string, p: SduiProps, children?: SpecNodeJSON[], action?: SpecActionJSON): SpecNodeJSON => {
      const out: SpecNodeJSON = { type: specType }
      if (c.id) out.id = toIdentifier(c.id, 'node')
      const merged = { ...p, ...shared }
      if (Object.keys(merged).length) out.props = merged
      if (children && children.length) out.children = children
      if (action) out.action = action
      return out
    }
    const stackProps = (direction: 'column' | 'row'): SduiProps => {
      const p: SduiProps = {}
      const gap = px(style.gap ?? props.gap)
      if (gap !== undefined) p.spacing = gap
      const align = String(style.alignItems ?? props.align ?? '')
      const map = direction === 'column'
        ? { 'flex-start': 'leading', start: 'leading', center: 'center', 'flex-end': 'trailing', end: 'trailing' }
        : { 'flex-start': 'top', start: 'top', center: 'center', 'flex-end': 'bottom', end: 'bottom' }
      const a = (map as Record<string, string>)[align]
      p.alignment = a ?? (direction === 'column' ? 'leading' : 'center')
      return p
    }

    switch (type) {
      case 'Container':
      case 'Flex': {
        const direction = String(style.flexDirection ?? props.direction ?? (type === 'Flex' ? 'row' : 'column')).startsWith('row') ? 'row' : 'column'
        const color = hexColor(style.color)
        const p = stackProps(direction)
        if (color) p.foreground = color
        return node(direction === 'row' ? 'hstack' : 'vstack', p, kids())
      }
      case 'Card':
        return node('card', hexColor(style.color) ? { foreground: hexColor(style.color)! } : {}, kids())
      case 'Hero':
        this.warn(c.id, 'Hero → card (layered artwork is not reproduced)')
        return node('card', {}, kids())
      case 'Grid':
        return node('grid', { columns: Math.max(1, Math.trunc(Number(props.columns ?? 2)) || 2), spacing: px(props.gap ?? style.gap) ?? 8 }, kids())
      case 'Space':
        return node('spacer', { height: px(props.height ?? style.height) ?? 16 })
      case 'Divider':
        if (props.label) this.warn(c.id, 'divider label dropped')
        return node('divider', {})
      case 'Heading': {
        const level = Number(props.level ?? 2)
        return node('text', this.textProps(c, String(props.content ?? props.text ?? ''), level <= 2 ? 'title' : 'headline'))
      }
      case 'Text':
        return node('text', this.textProps(c, String(props.content ?? props.text ?? ''), undefined))
      case 'Image': {
        const src = String(props.src ?? '')
        const p: SduiProps = { name: toIdentifier(src.split('/').pop()?.replace(/\.[a-z0-9]+(\?.*)?$/i, '') ?? '', 'image'), contentMode: 'fill' }
        if (props.alt) p.a11yLabel = String(props.alt)
        if (src) this.warn(c.id, `image src "${src}" → asset name "${p.name}" (map it in the app's assetURL)`)
        return node('image', p)
      }
      case 'Button': {
        const action = this.action(c, (props.action as Obj | undefined) ?? c.action, form)
        const p: SduiProps = { title: String(props.label ?? props.text ?? 'Button') }
        if (background) p.variant = 'primary'
        return node('button', p, undefined, action)
      }
      case 'Link': {
        const href = String(props.href ?? '')
        const link = toIdentifier(href, 'link')
        this.warn(c.id, `link href "${href}" → named link "${link}" (map it in the app's link allow-list)`)
        return node('button', { title: String(props.label ?? props.text ?? 'Link'), variant: 'plain' }, undefined, { type: 'openURL', link })
      }
      case 'Form': {
        const fields = collectFields(c)
        const submit = (props.action as Obj | undefined) ?? c.action
        const children = kids({ fields, submit })
        if (!(c.children ?? []).length && Array.isArray(props.fields)) {
          for (const f of props.fields as Obj[]) children.push(this.field({ id: `${c.id}-${f.name}`, component: f.type === 'select' ? 'Select' : 'Input', props: f }))
          children.push({ type: 'button', props: { title: String(props.submitLabel ?? 'Submit'), variant: 'primary' }, action: this.submitAction(fields.length ? fields : (props.fields as Obj[]).map((f) => String(f.name)), submit) })
        }
        return node('form', {}, children)
      }
      case 'Input':
      case 'Select':
      case 'Textarea':
        return this.field(c)
      case 'Toast':
      case 'Modal':
        this.warn(c.id, `${type} component dropped — use a toast action / navigate(presentation: "sheet")`)
        return null
      default:
        this.warn(c.id, `unknown legacy type "${type}" kept as-is (renders a placeholder)`)
        return node(toIdentifier(type, 'unknown'), {}, kids())
    }
  }

  private textProps(c: LegacyComponent, value: string, styleName: string | undefined): SduiProps {
    const style = c.style ?? {}
    const p: SduiProps = { value }
    if (styleName) p.style = styleName
    const color = hexColor(style.color)
    if (color) p.color = color
    const size = px(style.fontSize)
    if (size !== undefined) p.size = size
    const weight = WEIGHTS[String(style.fontWeight ?? '')]
    if (weight) p.weight = weight
    return p
  }

  private field(c: LegacyComponent): SpecNodeJSON {
    const type = c.type ?? c.component
    const props = c.props ?? {}
    const p: SduiProps = { name: toIdentifier(String(props.name ?? 'field'), 'field') }
    for (const key of ['label', 'placeholder'] as const) if (props[key] != null) p[key] = String(props[key])
    if (props.required) p.required = true
    for (const key of ['minLength', 'maxLength'] as const) if (px(props[key]) !== undefined) p[key] = px(props[key])!
    let specType = 'textField'
    if (type === 'Select') {
      specType = 'picker'
      p.options = ((props.options as unknown[]) ?? []).map((o) => (typeof o === 'string' ? o : { value: String((o as Obj).value ?? ''), label: String((o as Obj).label ?? (o as Obj).value ?? '') })) as SduiValue
    } else if (type === 'Textarea') {
      specType = 'textArea'
      if (props.rows != null) p.rows = Number(props.rows)
    } else {
      const inputType = String(props.type ?? 'text')
      if (inputType === 'email') { p.keyboard = 'email'; p.pattern = 'email' }
      else if (inputType === 'tel') { p.keyboard = 'phone'; p.pattern = 'phoneId' }
      else if (inputType === 'number') { p.keyboard = 'number'; p.pattern = 'numeric' }
      else if (inputType === 'password') p.secure = true
    }
    for (const rule of (props.validation as Obj[] | undefined) ?? []) {
      const name = String(rule.rule ?? rule.type ?? '')
      if (name === 'email') p.pattern = 'email'
      else if (name === 'pattern' || name === 'regex') this.warn(c.id, 'regex validation dropped — use a named pattern (ReDoS-safe)')
    }
    const out: SpecNodeJSON = { type: specType, props: p }
    if (c.id) out.id = toIdentifier(c.id, 'field')
    return out
  }

  private submitAction(fields: string[], submit: Obj | undefined): SpecActionJSON {
    const action: SpecActionJSON = {
      type: 'api',
      request: `submit_${toIdentifier(this.pageKey, 'form')}`,
      params: Object.fromEntries(fields.map((f) => [f, `{{form.${f}}}`]))
    }
    const target = (submit?.params as Obj | undefined)?.target ?? submit?.target
    action.onSuccess = target ? { type: 'navigate', screen: toIdentifier(String(target), 'home') } : { type: 'toast', message: 'Submitted', level: 'success' }
    action.onError = { type: 'toast', message: 'Submission failed', level: 'error' }
    this.warn(undefined, `form submit → api "${action.request}" (map it in the app's endpoint allow-list)`)
    return action
  }

  action(c: LegacyComponent, raw: Obj | undefined, form?: { fields: string[]; submit?: Obj }, depth = 0): SpecActionJSON | undefined {
    if (!raw || depth > 4) return undefined
    const behavior = String(raw.behavior ?? raw.action ?? '')
    const params = raw.params && typeof raw.params === 'object' ? (raw.params as SduiProps) : undefined
    const chain = (a: SpecActionJSON) => {
      const ok = this.action(c, raw.onSuccess as Obj | undefined, form, depth + 1)
      const err = this.action(c, raw.onError as Obj | undefined, form, depth + 1)
      if (ok) a.onSuccess = ok
      if (err) a.onError = err
      return a
    }
    switch (behavior) {
      case 'navigate': {
        const out: SpecActionJSON = { type: 'navigate', screen: toIdentifier(String(raw.target ?? ''), 'home') }
        if (params && Object.keys(params).length) out.params = params
        return chain(out)
      }
      case 'back':
      case 'closeModal':
        return { type: 'dismiss' }
      case 'externalLink': {
        const href = String(raw.href ?? raw.url ?? '')
        const link = toIdentifier(href, 'link')
        this.warn(c.id, `externalLink "${href}" → named link "${link}"`)
        return { type: 'openURL', link }
      }
      case 'submit':
        if (form) return this.submitAction(form.fields, form.submit ?? raw)
        this.warn(c.id, 'submit outside a form → api')
        return chain({ type: 'api', request: `submit_${toIdentifier(this.pageKey, 'form')}`, ...(params ? { params } : {}) })
      case 'toast':
        return chain({ type: 'toast', message: String(raw.message ?? ''), level: 'info' })
      case 'openModal':
        return { type: 'navigate', screen: toIdentifier(String(raw.modalId ?? 'modal'), 'modal'), presentation: 'sheet' }
      case 'api': {
        const url = String(raw.url ?? '')
        const request = toIdentifier(url.split('?')[0]!.split('/').filter(Boolean).pop() ?? 'request', 'request')
        this.warn(c.id, `api url "${url}" → named request "${request}" (raw URLs are not allowed in payloads)`)
        return chain({ type: 'api', request, ...(params ? { params } : {}) })
      }
      case 'customEvent':
        this.warn(c.id, `customEvent "${String(raw.eventName ?? '')}" dropped — use a registered native command`)
        return undefined
      default:
        if (behavior) this.warn(c.id, `unknown behavior "${behavior}" dropped`)
        return undefined
    }
  }
}

function collectFields(c: LegacyComponent): string[] {
  const out: string[] = []
  const walk = (n: LegacyComponent) => {
    const type = n.type ?? n.component
    if ((type === 'Input' || type === 'Select' || type === 'Textarea') && n.props?.name) out.push(toIdentifier(String(n.props.name), 'field'))
    for (const k of n.children ?? []) walk(k)
  }
  for (const k of c.children ?? []) walk(k)
  return out
}

/// Flat `parentId + order` list (or already nested) → nested roots.
function toTree(components: LegacyComponent[]): LegacyComponent[] {
  if (components.every((c) => c.parentId === undefined) && components.some((c) => c.children)) return components
  const byId = new Map<string, LegacyComponent>()
  for (const c of components) byId.set(String(c.id), { ...c, children: [] })
  const roots: LegacyComponent[] = []
  for (const c of [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const self = byId.get(String(c.id))!
    const parent = c.parentId ? byId.get(String(c.parentId)) : undefined
    if (parent) parent.children!.push(self)
    else roots.push(self)
  }
  return roots
}

/// Convert a legacy UniversalPageConfig (or its `layout`, or a component array).
export function fromUniversal(page: unknown, options: { key?: string } = {}): ConversionResult {
  const p = (page ?? {}) as Obj
  const layout = (p.layout ?? p) as Obj
  const components = (Array.isArray(page) ? page : (layout.components as LegacyComponent[] | undefined) ?? []) as LegacyComponent[]
  const key = toIdentifier(options.key ?? String(p.pageKey ?? 'screen'), 'screen')
  const converter = new Converter(key)
  const roots = toTree(components).map((c) => converter.convert(c)).filter((n): n is SpecNodeJSON => n !== null)
  const root: SpecNodeJSON = roots.length === 1 ? roots[0]! : { type: 'vstack', props: { spacing: 16, alignment: 'leading' }, children: roots }
  return { payload: { schemaVersion: SPEC_VERSION, screen: { key, root } }, warnings: converter.warnings }
}
