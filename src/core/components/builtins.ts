import type { Component } from '../component-factory'
import type { RenderContext } from '../render-context'
import type { SduiNode } from '../node'
import { SduiValue } from '../value'
import { cleanAttrs, renderNode, type RenderNode } from '../render-node'
import { color, fontWeight, numberProp, sharedStyle, textStyle } from '../style'
import { Symbols } from './symbols'
import type { FieldRule } from '../patterns'

// The built-in set — v1 (murti): text, image, vstack, hstack, zstack, button,
// card; v1.1: spacer, divider, grid, scroll, list, form, textField, textArea,
// picker. Each is one small class producing a RenderNode: the template
// third-party components follow.

const DEFAULT_SPACING = 8

/// Accessibility props → attributes: `a11yLabel` → aria-label (tokens resolved),
/// `a11yId` → data-testid, `a11yTraits` → role.
function a11y(node: SduiNode, ctx: RenderContext): Record<string, string> {
  const attrs: Record<string, string> = {}
  const label = node.string('a11yLabel')
  if (label) attrs['aria-label'] = ctx.resolve(label)
  const id = node.string('a11yId')
  if (id) attrs['data-testid'] = id
  for (const trait of node.array('a11yTraits')) {
    if (trait === 'button') attrs.role = 'button'
    if (trait === 'header') { attrs.role = 'heading'; attrs['aria-level'] = '2' }
    if (trait === 'image') attrs.role = 'img'
    if (trait === 'link') attrs.role = 'link'
  }
  return attrs
}

const spacing = (node: SduiNode) => numberProp(node, 'spacing') ?? DEFAULT_SPACING
const px = (n: number) => `${n}px`

function container(node: SduiNode, ctx: RenderContext, style: Record<string, string>, children: RenderNode[]): RenderNode {
  return renderNode(ctx.keyFor(node), 'div', {
    type: node.type,
    attrs: a11y(node, ctx),
    style: { ...style, ...sharedStyle(node) },
    children
  })
}

// MARK: - text

export class TextComponent implements Component {
  static readonly type = 'text'
  static readonly category = 'content'
  static readonly defaultProps = { value: 'Text' }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const template = node.string('value')
    const base = textStyle(node.string('style'))
    const size = numberProp(node, 'size') ?? base.size
    const weight = fontWeight(node.string('weight')) ?? base.weight
    const style: Record<string, string> = {
      display: 'block', margin: '0', whiteSpace: 'pre-wrap',
      fontSize: px(size), fontWeight: String(weight), lineHeight: '1.3'
    }
    const c = color(node.string('color'))
    if (c) style.color = c
    if (ctx.pending(template)) {
      // a `screen.load` result this text needs hasn't arrived yet → skeleton
      return renderNode(ctx.keyFor(node), 'span', {
        type: node.type,
        attrs: { 'aria-busy': 'true', ...a11y(node, ctx) },
        style: { ...style, ...sharedStyle(node), minWidth: '6em', minHeight: `${size * 1.3}px`, background: 'rgba(120,120,128,0.16)', borderRadius: '4px' }
      })
    }
    return renderNode(ctx.keyFor(node), 'span', {
      type: node.type,
      attrs: a11y(node, ctx),
      style: { ...style, ...sharedStyle(node) },
      text: ctx.resolve(template)
    })
  }
}

// MARK: - image

export class ImageComponent implements Component {
  static readonly type = 'image'
  static readonly category = 'content'
  static readonly defaultProps = { systemName: 'star.fill' }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    // `systemName` renders a symbol glyph; `name` renders an app-resolved asset.
    // A raw URL is never taken from the payload.
    const key = ctx.keyFor(node)
    const width = numberProp(node, 'width')
    const height = numberProp(node, 'height')
    const systemName = node.string('systemName')
    if (systemName) {
      return renderNode(key, 'span', {
        type: node.type,
        attrs: a11y(node, ctx),
        style: { display: 'inline-flex', ...sharedStyle(node) },
        children: [Symbols.node(`${key}:symbol`, systemName)]
      })
    }
    const label = node.string('a11yLabel')
    return renderNode(key, 'img', {
      type: node.type,
      attrs: cleanAttrs({ src: ctx.env.assetURL(node.string('name')), alt: label ? ctx.resolve(label) : '', loading: 'lazy', ...a11y(node, ctx) }),
      style: {
        display: 'block',
        width: width !== undefined ? px(width) : '100%',
        height: height !== undefined ? px(height) : 'auto',
        objectFit: node.string('contentMode') === 'fill' ? 'cover' : 'contain',
        ...sharedStyle(node)
      }
    })
  }
}

// MARK: - stacks

const H_ALIGN: Record<string, string> = { leading: 'flex-start', center: 'center', trailing: 'flex-end' }
const V_ALIGN: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' }

export class VStackComponent implements Component {
  static readonly type = 'vstack'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  static readonly defaultProps = { spacing: 8 }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    return container(node, ctx, {
      display: 'flex', flexDirection: 'column',
      alignItems: H_ALIGN[node.string('alignment')] ?? 'center', gap: px(spacing(node))
    }, ctx.children(node))
  }
}

export class HStackComponent implements Component {
  static readonly type = 'hstack'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  static readonly defaultProps = { spacing: 8 }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    return container(node, ctx, {
      display: 'flex', flexDirection: 'row',
      alignItems: V_ALIGN[node.string('alignment')] ?? 'center', gap: px(spacing(node))
    }, ctx.children(node))
  }
}

/// Overlays children. With a `width`/`height` (the source frame's size) and
/// `x`/`y`/`width`/`height` on each child, children are placed proportionally
/// (percentages of the frame) and the frame keeps its aspect ratio at any width.
/// Without a frame size it's a plain centered overlay.
export class ZStackComponent implements Component {
  static readonly type = 'zstack'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const width = numberProp(node, 'width') ?? 0
    const height = numberProp(node, 'height') ?? 0
    if (!(width > 0 && height > 0)) {
      const kids = ctx.children(node).map((k) => ({ ...k, style: { ...k.style, gridArea: '1 / 1' } }))
      return container(node, ctx, { display: 'grid', placeItems: 'center' }, kids)
    }
    const slots: RenderNode[] = []
    node.children.forEach((child, i) => {
      const view = ctx.child(i).view(child)
      if (!view) return
      const box = childBox(child, width, height)
      const pct = (v: number, of: number) => `${(v / of) * 100}%`
      slots.push(renderNode(`${view.key}:slot`, 'div', {
        style: {
          position: 'absolute', left: pct(box.x, width), top: pct(box.y, height),
          width: pct(box.width, width), height: pct(box.height, height),
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        },
        children: [view]
      }))
    })
    return container(node, ctx, { position: 'relative', width: '100%', aspectRatio: `${width} / ${height}`, overflow: 'hidden' }, slots)
  }
}

/// The absolute box of a `zstack` child, defaulting to the whole frame.
export function childBox(node: SduiNode, frameWidth: number, frameHeight: number) {
  return {
    x: numberProp(node, 'x') ?? 0,
    y: numberProp(node, 'y') ?? 0,
    width: numberProp(node, 'width') ?? frameWidth,
    height: numberProp(node, 'height') ?? frameHeight
  }
}

// MARK: - button

const BUTTON_VARIANTS: Record<string, Record<string, string>> = {
  primary: { background: color('primary')!, color: color('onPrimary')!, border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: '600' },
  secondary: { background: color('surface')!, color: color('onSurface')!, border: `1px solid ${color('border')}`, padding: '10px 16px', borderRadius: '10px', fontWeight: '600' },
  plain: { background: 'transparent', color: color('primary')!, border: 'none', padding: '0' }
}

export class ButtonComponent implements Component {
  static readonly type = 'button'
  static readonly category = 'action'
  static readonly defaultProps = { title: 'Button' }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const variant = BUTTON_VARIANTS[node.string('variant')] ?? BUTTON_VARIANTS.plain!
    const busy = ctx.busy(node)
    return renderNode(ctx.keyFor(node), 'button', {
      type: node.type,
      attrs: cleanAttrs({ type: 'button', disabled: busy, 'aria-busy': busy ? 'true' : undefined, ...a11y(node, ctx) }),
      style: { font: 'inherit', fontSize: '16px', cursor: busy ? 'progress' : 'pointer', opacity: busy ? '0.6' : '1', textAlign: 'center', ...variant, ...sharedStyle(node) },
      text: ctx.resolve(node.string('title')),
      on: ctx.onClick(node, node.action)
    })
  }
}

// MARK: - card

export class CardComponent implements Component {
  static readonly type = 'card'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    // A grey rounded box is the default; `background`, `cornerRadius`, `padding`,
    // and `foreground` override it.
    return renderNode(ctx.keyFor(node), 'div', {
      type: node.type,
      attrs: a11y(node, ctx),
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: px(DEFAULT_SPACING),
        ...sharedStyle(node, { padding: 16, background: 'surface', cornerRadius: 12 })
      },
      children: ctx.children(node)
    })
  }
}

// MARK: - v1.1 layout

export class SpacerComponent implements Component {
  static readonly type = 'spacer'
  static readonly category = 'layout'
  static readonly defaultProps = { height: 16 }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const height = numberProp(node, 'height')
    const width = numberProp(node, 'width')
    return renderNode(ctx.keyFor(node), 'div', {
      type: node.type,
      attrs: { 'aria-hidden': 'true' },
      style: height === undefined && width === undefined
        ? { flex: '1 1 0' }
        : { flex: '0 0 auto', height: px(height ?? 0), width: px(width ?? 0) }
    })
  }
}

export class DividerComponent implements Component {
  static readonly type = 'divider'
  static readonly category = 'layout'
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    return renderNode(ctx.keyFor(node), 'hr', {
      type: node.type,
      style: { alignSelf: 'stretch', border: 'none', borderTop: `1px solid ${color('border')}`, margin: '0', width: '100%' }
    })
  }
}

export class GridComponent implements Component {
  static readonly type = 'grid'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  static readonly defaultProps = { columns: 2, spacing: 8 }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const columns = Math.min(12, Math.max(1, Math.trunc(numberProp(node, 'columns') ?? 2)))
    return container(node, ctx, {
      display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: px(spacing(node)), alignSelf: 'stretch'
    }, ctx.children(node))
  }
}

export class ScrollComponent implements Component {
  static readonly type = 'scroll'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const horizontal = node.string('axis') === 'horizontal'
    return container(node, ctx, horizontal
      ? { display: 'flex', flexDirection: 'row', gap: px(spacing(node)), overflowX: 'auto', alignSelf: 'stretch' }
      : { display: 'flex', flexDirection: 'column', overflowY: 'auto', alignSelf: 'stretch', maxHeight: '100%' },
    ctx.children(node))
  }
}

/// Repeats its children (the row template) once per item of the array at the
/// `items` key path; each row sees its item as `{{<as>.*}}` (default `item`).
export class ListComponent implements Component {
  static readonly type = 'list'
  static readonly category = 'layout'
  static readonly acceptsChildren = true
  static readonly defaultProps = { items: 'items', as: 'item' }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const items = SduiValue.arrayValue(ctx.data.value(node.string('items'))) ?? []
    const as = node.string('as') || 'item'
    const rows = items.map((item, i) => {
      const rowCtx = ctx.child(`r${i}`, { [as]: item })
      return renderNode(`${ctx.keyFor(node)}:row${i}`, 'li', {
        style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: px(DEFAULT_SPACING) },
        children: rowCtx.children(node)
      })
    })
    return renderNode(ctx.keyFor(node), 'ul', {
      type: node.type,
      attrs: a11y(node, ctx),
      style: { margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: px(spacing(node)), alignSelf: 'stretch', ...sharedStyle(node) },
      children: rows
    })
  }
}

// MARK: - v1.1 forms

/// Opens the `form.*` data scope: its fields write there, and buttons inside it
/// validate the fields before their action runs.
export class FormComponent implements Component {
  static readonly type = 'form'
  static readonly category = 'form'
  static readonly acceptsChildren = true
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const formId = node.id ?? `form${ctx.path}`
    const values = ctx.ui.forms[formId]?.values ?? {}
    return renderNode(ctx.keyFor(node), 'form', {
      type: node.type,
      attrs: { novalidate: true, 'data-sdui-form': formId, ...a11y(node, ctx) },
      style: { display: 'flex', flexDirection: 'column', gap: px(spacing(node)), alignSelf: 'stretch', ...sharedStyle(node) },
      preventDefault: true,
      children: ctx.children(node, { form: values }, formId)
    })
  }
}

const INPUT_MODE: Record<string, { type: string; inputmode?: string; autocomplete?: string }> = {
  text: { type: 'text' },
  number: { type: 'text', inputmode: 'decimal' },
  email: { type: 'email', inputmode: 'email', autocomplete: 'email' },
  phone: { type: 'tel', inputmode: 'tel', autocomplete: 'tel' }
}

function fieldRule(node: SduiNode): FieldRule {
  return {
    name: node.string('name'),
    label: node.string('label') || undefined,
    required: node.bool('required'),
    minLength: numberProp(node, 'minLength'),
    maxLength: numberProp(node, 'maxLength'),
    pattern: node.string('pattern') || undefined
  }
}

const FIELD_STYLE: Record<string, string> = {
  display: 'block', width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: '16px',
  padding: '10px 12px', border: `1px solid ${color('border')}`, borderRadius: '8px',
  background: color('background')!, color: color('onSurface')!
}

function field(node: SduiNode, ctx: RenderContext, control: (attrs: Record<string, string | number | boolean>, value: string) => RenderNode): RenderNode {
  const key = ctx.keyFor(node)
  const rule = fieldRule(node)
  const formId = ctx.formId ?? `form${ctx.path}`
  if (rule.name) ctx.env.sink.registerField(formId, rule)
  const form = ctx.ui.forms[formId]
  const value = form?.values[rule.name] ?? ''
  const error = ctx.interactive ? form?.errors[rule.name] : undefined
  const attrs = cleanAttrs({
    name: rule.name, required: rule.required, minlength: rule.minLength, maxlength: rule.maxLength,
    placeholder: node.string('placeholder') ? ctx.resolve(node.string('placeholder')) : undefined,
    disabled: !ctx.interactive, 'aria-invalid': error ? 'true' : undefined, ...a11y(node, ctx)
  })
  const input = control(attrs, value)
  if (ctx.interactive && rule.name) input.field = { formId, name: rule.name }
  const label = rule.label ? ctx.resolve(rule.label) : rule.name
  const children: RenderNode[] = [
    renderNode(`${key}:label`, 'span', {
      style: { display: 'block', fontSize: '13px', marginBottom: '4px', color: color('muted')! },
      text: rule.required ? `${label} *` : label
    }),
    input
  ]
  if (error) children.push(renderNode(`${key}:error`, 'span', { attrs: { role: 'alert' }, style: { display: 'block', fontSize: '12px', marginTop: '4px', color: color('danger')! }, text: error }))
  return renderNode(key, 'label', { type: node.type, style: { display: 'block', alignSelf: 'stretch', ...sharedStyle(node) }, children })
}

export class TextFieldComponent implements Component {
  static readonly type = 'textField'
  static readonly category = 'form'
  static readonly defaultProps = { name: 'field', label: 'Field' }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const secure = node.bool('secure')
    const mode = INPUT_MODE[node.string('keyboard')] ?? INPUT_MODE.text!
    return field(node, ctx, (attrs, value) => renderNode(`${ctx.keyFor(node)}:control`, 'input', {
      attrs: cleanAttrs({
        ...attrs,
        type: secure ? 'password' : mode.type,
        inputmode: mode.inputmode,
        autocomplete: secure ? 'off' : mode.autocomplete,
        'data-sdui-secure': secure ? 'true' : undefined,
        value: ctx.interactive ? value : undefined
      }),
      style: FIELD_STYLE
    }))
  }
}

export class TextAreaComponent implements Component {
  static readonly type = 'textArea'
  static readonly category = 'form'
  static readonly defaultProps = { name: 'notes', label: 'Notes', rows: 3 }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    return field(node, ctx, (attrs, value) => renderNode(`${ctx.keyFor(node)}:control`, 'textarea', {
      attrs: cleanAttrs({ ...attrs, rows: Math.min(20, Math.max(1, Math.trunc(numberProp(node, 'rows') ?? 3))), value: ctx.interactive ? value : undefined }),
      style: { ...FIELD_STYLE, resize: 'vertical' }
    }))
  }
}

export class PickerComponent implements Component {
  static readonly type = 'picker'
  static readonly category = 'form'
  static readonly defaultProps = { name: 'choice', label: 'Choice', options: [] }
  makeView(node: SduiNode, ctx: RenderContext): RenderNode {
    const key = ctx.keyFor(node)
    const options = node.array('options').map((o, i) => {
      const value = typeof o === 'string' ? o : String(SduiValue.objectValue(o)?.value ?? '')
      const label = typeof o === 'string' ? o : String(SduiValue.objectValue(o)?.label ?? value)
      return renderNode(`${key}:opt${i}`, 'option', { attrs: { value }, text: ctx.resolve(label) })
    })
    return field(node, ctx, (attrs, value) => renderNode(`${key}:control`, 'select', {
      attrs: cleanAttrs({ ...attrs, value: ctx.interactive ? value : undefined }),
      style: FIELD_STYLE,
      children: [renderNode(`${key}:opt`, 'option', { attrs: { value: '' }, text: node.string('placeholder') || 'Select…' }), ...options]
    }))
  }
}

export const BUILTIN_COMPONENTS = [
  VStackComponent, HStackComponent, ZStackComponent, CardComponent, GridComponent, ScrollComponent, ListComponent,
  SpacerComponent, DividerComponent,
  TextComponent, ImageComponent,
  FormComponent, TextFieldComponent, TextAreaComponent, PickerComponent,
  ButtonComponent
]
