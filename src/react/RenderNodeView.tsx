/// React binding for RenderNode — the only rendering code in the React adapter.
/// No component-type branches: element, attrs, style and text come from core.
import React from 'react'
import type { RenderNode } from '../core/render-node'
import type { ScreenController } from '../core/screen'

const ATTR_ALIASES: Record<string, string> = {
  novalidate: 'noValidate', class: 'className', for: 'htmlFor', minlength: 'minLength', maxlength: 'maxLength',
  inputmode: 'inputMode', autocomplete: 'autoComplete', 'fill-rule': 'fillRule', viewbox: 'viewBox'
}

/// Toolkit-specific components: `{ chart: (node) => <Chart … /> }`.
export type ReactSlots = Record<string, (slot: NonNullable<RenderNode['slot']>, node: RenderNode) => React.ReactNode>

export function RenderNodeView({ node, screen, slots }: { node: RenderNode; screen?: ScreenController; slots?: ReactSlots }): React.ReactElement {
  if (node.slot && slots?.[node.slot.type]) {
    return <div style={node.style as React.CSSProperties} data-sdui-slot={node.slot.type}>{slots[node.slot.type]!(node.slot, node)}</div>
  }
  const props: Record<string, unknown> = { style: node.style as React.CSSProperties }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    if (k === 'style' || /^on/i.test(k)) continue   // styles via CSSOM only; no handlers from attrs
    props[ATTR_ALIASES[k] ?? k] = v
  }

  if (node.field && screen) {
    const { formId, name } = node.field
    props.value = String(node.attrs.value ?? '')
    props.onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      screen.setFieldValue(formId, name, e.target.value)
  }
  if (node.on?.click && screen) {
    const key = node.on.click
    props.onClick = (e: React.MouseEvent) => {
      e.preventDefault()
      void screen.handle(key)
    }
  }
  if (node.element === 'form') props.onSubmit = (e: React.FormEvent) => e.preventDefault()

  const children = node.children.map((c) => <RenderNodeView key={c.key} node={c} screen={screen} slots={slots} />)
  if (node.element === 'input' || node.element === 'img' || node.element === 'hr' || node.element === 'textarea') {
    return React.createElement(node.element, props)
  }
  return React.createElement(node.element, props, node.text, ...children)
}

export default RenderNodeView
