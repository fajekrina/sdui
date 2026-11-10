/**
 * Fajrina SDUI — View-model: component tree → RenderNode tree.
 *
 * Every rendering decision (element, attributes, final style, text, field
 * binding, event wiring) is made here, once. Adapters render RenderNodes
 * generically and never branch on component type — that is what keeps
 * React, Vue and vanilla pixel-identical.
 */

import type { UniversalComponent } from './types'
import { getComponentType } from './types'
import { buildLayoutStyle } from './style'
import { resolveAction, checkUrl, checkMediaUrl, type FieldRule } from './actions'
import type { SduiPolicy } from './validate'
import type { UiState } from './ui-store'
import type { LoggerPort } from './ports'

export type RenderElement =
  | 'div' | 'section' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span'
  | 'img' | 'a' | 'button' | 'form' | 'input' | 'select' | 'option' | 'textarea' | 'label' | 'hr'

export interface RenderNode {
  /** stable key for reconciliation (component id, or id:suffix for synthetic parts) */
  key: string
  /** component type when this node is the root of a component */
  type?: string
  element: RenderElement
  /** already sanitized; booleans are only present when true */
  attrs: Record<string, string | number | boolean>
  /** final style: preset → theme/token → inline already applied */
  style: Record<string, string>
  /** text content — adapters render it as text, never as HTML */
  text?: string
  /** form field binding: value lives in the UI store */
  field?: { formId: string; name: string }
  /** event → handler key, passed back to runtime.handle(key) */
  on?: { click?: string; submit?: string }
  preventDefault?: boolean
  stopPropagation?: boolean
  children: RenderNode[]
}

export interface ViewContext {
  policy?: SduiPolicy
  state: UiState
  /** false = builder preview: no handlers, fields not bound */
  interactive: boolean
  dev: boolean
  logger: LoggerPort
  /** collects components by id (dispatch lookup) and field rules per form */
  index?: Map<string, UniversalComponent>
  formRules?: Map<string, FieldRule[]>
}

type Obj = Record<string, unknown>
const STANDALONE_FORM = '_standalone'
const FIELD_TYPES = new Set(['Input', 'Select', 'Textarea'])
const FIXED_ALLOWED = new Set(['Modal', 'Toast'])

const node = (key: string, element: RenderElement, extra: Partial<RenderNode> = {}): RenderNode => ({
  key, element, attrs: {}, style: {}, children: [], ...extra
})

const s = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v))

function finalStyle(type: string, comp: UniversalComponent, ctx: ViewContext, override?: Record<string, string>): Record<string, string> {
  const props = (comp.props ?? {}) as Obj
  const style = buildLayoutStyle(type, props, (override ?? comp.style ?? {}) as Record<string, string>)
  if (style.position === 'fixed' && !FIXED_ALLOWED.has(type)) {
    delete style.position
    ctx.logger.warn(`[fajrina-sdui:schema] ${comp.id} — position:fixed is only allowed on Modal/Toast (removed)`)
  }
  return style
}

function boolAttrs(attrs: Record<string, string | number | boolean | undefined | null>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || v === '') continue
    out[k] = v
  }
  return out
}

function fieldRule(props: Obj): FieldRule {
  const num = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v))
  return {
    name: s(props.name),
    label: props.label != null ? String(props.label) : undefined,
    required: Boolean(props.required),
    minLength: num(props.minLength),
    maxLength: num(props.maxLength),
    type: props.type != null ? String(props.type) : undefined,
    validation: Array.isArray(props.validation) ? (props.validation as FieldRule['validation']) : undefined
  }
}

function labelWrap(key: string, label: string, required: boolean, control: RenderNode, error: string | undefined): RenderNode {
  const caption = node(`${key}:caption`, 'span', {
    style: { color: '#374151', display: 'block', marginBottom: '4px', fontSize: '13px' },
    text: label,
    children: required ? [node(`${key}:req`, 'span', { style: { color: '#ef4444' }, text: ' *' })] : []
  })
  const children = [caption, control]
  if (error) children.push(node(`${key}:error`, 'span', { style: { display: 'block', color: '#ef4444', fontSize: '12px', marginTop: '4px' }, text: error, attrs: { role: 'alert' } }))
  return node(key, 'label', { style: { display: 'block', fontSize: '14px' }, children })
}

function renderField(comp: UniversalComponent, type: string, props: Obj, ctx: ViewContext, formId: string, styleOverride?: Record<string, string>): RenderNode {
  const name = s(props.name)
  const rule = fieldRule(props)
  if (name) {
    const list = ctx.formRules?.get(formId) ?? []
    list.push(rule)
    ctx.formRules?.set(formId, list)
  }
  const form = ctx.state.forms[formId]
  const value = form?.values[name] ?? ''
  const error = form?.errors[name]
  const style = styleOverride ? buildLayoutStyle(type, props, styleOverride) : finalStyle(type, comp, ctx)
  const field = ctx.interactive && name ? { formId, name } : undefined
  let control: RenderNode
  if (type === 'Select') {
    const opts = (props.options as unknown[] | undefined) ?? []
    const options = [node(`${comp.id}:opt:`, 'option', { attrs: { value: '' }, text: s(props.placeholder, 'Select') })]
    opts.forEach((o) => {
      const v = typeof o === 'string' ? o : s((o as Obj)?.value)
      const l = typeof o === 'string' ? o : s((o as Obj)?.label ?? v)
      options.push(node(`${comp.id}:opt:${v}`, 'option', { attrs: { value: v }, text: l }))
    })
    control = node(`${comp.id}:control`, 'select', {
      attrs: boolAttrs({ name, required: rule.required, value: ctx.interactive ? value : undefined, disabled: !ctx.interactive }),
      style, field, children: options
    })
  } else if (type === 'Textarea') {
    control = node(`${comp.id}:control`, 'textarea', {
      attrs: boolAttrs({ name, placeholder: s(props.placeholder), rows: Number(props.rows ?? 4), required: rule.required, minLength: rule.minLength, maxLength: rule.maxLength, value: ctx.interactive ? value : undefined, disabled: !ctx.interactive }),
      style, field
    })
  } else {
    control = node(`${comp.id}:control`, 'input', {
      attrs: boolAttrs({ name, type: s(props.type, 'text'), placeholder: s(props.placeholder), required: rule.required, minLength: rule.minLength, maxLength: rule.maxLength, value: ctx.interactive ? value : undefined, disabled: !ctx.interactive }),
      style, field
    })
  }
  const wrapped = labelWrap(comp.id, s(props.label ?? props.name ?? type), rule.required ?? false, control, ctx.interactive ? error : undefined)
  wrapped.type = type
  return wrapped
}

function interactiveClick(n: RenderNode, comp: UniversalComponent, ctx: ViewContext, preventDefault = false): RenderNode {
  if (!ctx.interactive) return n
  n.on = { ...(n.on ?? {}), click: `dispatch:${comp.id}` }
  if (preventDefault) n.preventDefault = true
  return n
}

function modalBox(key: string, title: string | undefined, message: string | undefined, children: RenderNode[], ctx: ViewContext, backdropStyle: Record<string, string>, fallback?: { title: string; message: string }): RenderNode {
  const inner: RenderNode[] = []
  const t = title || fallback?.title
  const m = message || fallback?.message
  if (t) inner.push(node(`${key}:title`, 'h3', { style: { fontSize: '18px', fontWeight: '700', margin: '0', color: '#0f172a' }, text: t }))
  if (m) inner.push(node(`${key}:message`, 'p', { style: { fontSize: '14px', color: '#475569', margin: '8px 0 0 0' }, text: m }))
  if (children.length) inner.push(node(`${key}:body`, 'div', { style: { marginTop: '12px' }, children }))
  const close = node(`${key}:close`, 'button', { attrs: { type: 'button' }, style: buildLayoutStyle('Button', {}, {}), text: 'Close' })
  if (ctx.interactive) close.on = { click: 'closeModal' }
  inner.push(node(`${key}:actions`, 'div', { style: { marginTop: '12px', textAlign: 'right' }, children: [close] }))
  const box = node(`${key}:box`, 'div', {
    style: { background: '#fff', borderRadius: '12px', maxWidth: '520px', width: '90%', padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,.2)' },
    stopPropagation: ctx.interactive, children: inner
  })
  const backdrop = node(key, 'div', { style: backdropStyle, children: [box] })
  if (ctx.interactive) backdrop.on = { click: 'closeModal' }
  return backdrop
}

/** Render one component (and its subtree). Unknown types → null (Null-Object) or a dev marker. */
export function renderComponent(comp: UniversalComponent, ctx: ViewContext, formId?: string): RenderNode | null {
  const type = getComponentType(comp)
  const props = (comp.props ?? {}) as Obj
  const children = (comp.children ?? []) as UniversalComponent[]
  ctx.index?.set(comp.id, comp)
  const kids = (fid = formId) => children.map((c) => renderComponent(c, ctx, fid)).filter((n): n is RenderNode => n !== null)
  const base = (element: RenderElement, extra: Partial<RenderNode> = {}) => node(comp.id, element, { type, style: finalStyle(type, comp, ctx), ...extra })

  switch (type) {
    case 'Heading': {
      const level = Math.min(6, Math.max(1, parseInt(s(props.level, '2'), 10) || 2))
      return base(`h${level}` as RenderElement, { text: s(props.content ?? props.text) })
    }
    case 'Text': {
      const tag = ['p', 'span', 'label'].includes(s(props.tag)) ? (s(props.tag) as RenderElement) : 'p'
      return base(tag, { text: s(props.content ?? props.text) })
    }
    case 'Image': {
      const style = finalStyle(type, comp, ctx)
      if (!style.maxHeight) style.maxHeight = '320px'
      const src = s(props.src)
      if (src && !checkMediaUrl(src)) ctx.logger.warn(`[fajrina-sdui:schema] ${comp.id} — image src scheme not allowed (removed)`)
      return node(comp.id, 'img', {
        type, style,
        attrs: boolAttrs({ src: checkMediaUrl(src) ? src : undefined, alt: s(props.alt), loading: s(props.loading, 'lazy') })
      })
    }
    case 'Button': {
      const action = resolveAction(comp)
      const declared = s(props.type, 'button')
      const isSubmit = formId != null && formId !== STANDALONE_FORM && (declared === 'submit' || !action || action.behavior === 'submit')
      const n = base('button', {
        attrs: boolAttrs({ type: isSubmit ? 'submit' : declared === 'reset' ? 'reset' : 'button', disabled: Boolean(props.disabled) }),
        text: s(props.label ?? props.text, 'Button')
      })
      return isSubmit ? n : interactiveClick(n, comp, ctx)
    }
    case 'Card': case 'Container': case 'Grid': case 'Flex': case 'Hero': case 'Space':
      return base('div', { children: kids() })
    case 'Divider': {
      const style = finalStyle(type, comp, ctx)
      if (!props.label) return node(comp.id, 'div', { type, style })
      return node(comp.id, 'div', {
        type,
        style: { display: 'flex', alignItems: 'center', gap: '12px', ...style },
        children: [
          node(`${comp.id}:l`, 'div', { style: { flex: '1', height: '1px', background: '#e2e8f0' } }),
          node(`${comp.id}:label`, 'span', { style: { fontSize: '12px', color: '#94a3b8' }, text: s(props.label) }),
          node(`${comp.id}:r`, 'div', { style: { flex: '1', height: '1px', background: '#e2e8f0' } })
        ]
      })
    }
    case 'Toast': {
      const msg = s(props.message ?? props.content ?? props.text)
      return base('div', msg ? { text: msg } : { children: kids() })
    }
    case 'Modal': {
      const n = modalBox(comp.id, props.title ? s(props.title) : undefined, props.message || props.content ? s(props.message ?? props.content) : undefined, kids(), ctx, finalStyle(type, comp, ctx))
      n.type = type
      return n
    }
    case 'Form': {
      const fid = comp.id
      ctx.formRules?.set(fid, []) // rules are rebuilt on every render of this form
      let inner: RenderNode[]
      if (children.length) {
        inner = kids(fid)
      } else {
        const fields = (props.fields as Obj[] | undefined) ?? []
        inner = fields.map((f) => {
          const t = s(f.type) === 'select' ? 'Select' : 'Input'
          const synthetic = { id: `${comp.id}-${s(f.name)}`, type: t, props: f } as UniversalComponent
          return renderField(synthetic, t, f, ctx, fid, {})
        })
        inner.push(node(`${comp.id}:submit`, 'button', { attrs: { type: 'submit' }, style: buildLayoutStyle('Button', {}, {}), text: s(props.submitLabel, 'Submit') }))
      }
      const n = base('form', {
        attrs: { 'data-fajrina-form': comp.id, novalidate: true },
        children: [node(`${comp.id}:stack`, 'div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' }, children: inner })]
      })
      if (ctx.interactive) { n.on = { submit: `submit:${comp.id}` }; n.preventDefault = true }
      else n.preventDefault = true
      return n
    }
    case 'Input': case 'Select': case 'Textarea':
      return renderField(comp, type, props, ctx, formId ?? STANDALONE_FORM)
    case 'Link': {
      const href = s(props.href, '#')
      const check = checkUrl(href, ctx.policy)
      if (!check.ok) ctx.logger.warn(`[fajrina-sdui:unlistedDomain] ${comp.id} — link ${check.reason} (href removed)`)
      const action = resolveAction(comp)
      const n = base('a', {
        attrs: boolAttrs({ href: check.ok ? href : '#', target: s(props.target, '_self'), rel: s(props.rel, 'noopener noreferrer') }),
        text: s(props.label ?? props.text, 'Link')
      })
      return action ? interactiveClick(n, comp, ctx, true) : n
    }
    default:
      if (ctx.dev) {
        return node(comp.id, 'div', { type, attrs: { title: `Unknown component type: ${type}` }, style: { border: '1px dashed #94a3b8', borderRadius: '4px', padding: '4px' } })
      }
      return null
  }
}

/** Toast + modal overlays from UI state. */
export function renderOverlays(ctx: ViewContext): RenderNode[] {
  const out: RenderNode[] = []
  ctx.state.toasts.forEach((t, i) => {
    const style = buildLayoutStyle('Toast', {}, {})
    if (i > 0) style.bottom = `${12 + i * 48}px`
    out.push(node(`toast:${t.id}`, 'div', { style, text: t.message, attrs: { role: 'status' } }))
  })
  const m = ctx.state.modal
  if (m) {
    out.push(modalBox(`modal:${m.id}`, m.title, m.message, [], ctx, buildLayoutStyle('Modal', {}, {}), { title: `Modal ${m.id}`, message: 'Ini modal overlay.' }))
  }
  return out
}

export function emptyNode(): RenderNode {
  return node('sdui:empty', 'div', {
    style: { textAlign: 'center', color: '#94a3b8', fontSize: '14px', padding: '48px 0' },
    text: 'No components — pass Universal JSON as data'
  })
}

export { FIELD_TYPES, STANDALONE_FORM }
