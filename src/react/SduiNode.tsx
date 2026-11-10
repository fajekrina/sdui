/**
 * React binding for RenderNode — the only rendering code in the React adapter.
 * No component-type branches: element, attrs, style and text come from core.
 */
import React from 'react'
import type { RenderNode } from '../core/view-model'
import type { SduiRuntime } from '../core/runtime'

const ATTR_ALIASES: Record<string, string> = { novalidate: 'noValidate', class: 'className', for: 'htmlFor' }

export function SduiNode({ node, runtime }: { node: RenderNode; runtime?: SduiRuntime }): React.ReactElement {
  const props: Record<string, unknown> = { style: node.style as React.CSSProperties }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    props[ATTR_ALIASES[k] ?? k] = v
  }

  if (node.field && runtime) {
    const { formId, name } = node.field
    props.value = String(node.attrs.value ?? '')
    props.onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      runtime.setFieldValue(formId, name, e.target.value)
  }

  if (node.on?.click || node.stopPropagation || (node.preventDefault && node.element === 'a')) {
    props.onClick = (e: React.MouseEvent) => {
      if (node.preventDefault) e.preventDefault()
      if (node.stopPropagation) e.stopPropagation()
      if (node.on?.click) runtime?.handle(node.on.click)
    }
  }
  if (node.element === 'form') {
    props.onSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      if (node.on?.submit) runtime?.handle(node.on.submit)
    }
  }

  const children = node.children.map((c) => <SduiNode key={c.key} node={c} runtime={runtime} />)
  if (node.element === 'input' || node.element === 'img' || node.element === 'hr') {
    return React.createElement(node.element, props)
  }
  if (node.element === 'textarea') {
    return React.createElement('textarea', props)
  }
  return React.createElement(node.element, props, node.text, ...children)
}

export default SduiNode
