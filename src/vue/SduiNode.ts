/**
 * Vue binding for RenderNode — the only rendering code in the Vue adapter.
 * No component-type branches: element, attrs, style and text come from core.
 */
import { defineComponent, h, type PropType, type VNode } from 'vue'
import type { RenderNode } from '../core/view-model'
import type { SduiRuntime } from '../core/runtime'

export function renderSduiNode(node: RenderNode, runtime?: SduiRuntime): VNode {
  const props: Record<string, unknown> = { key: node.key, style: node.style }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    props[k] = v
  }

  if (node.field && runtime) {
    const { formId, name } = node.field
    props.value = String(node.attrs.value ?? '')
    const handler = (e: Event) => runtime.setFieldValue(formId, name, (e.target as HTMLInputElement).value)
    if (node.element === 'select') props.onChange = handler
    else props.onInput = handler
  }

  if (node.on?.click || node.stopPropagation || (node.preventDefault && node.element === 'a')) {
    props.onClick = (e: Event) => {
      if (node.preventDefault) e.preventDefault()
      if (node.stopPropagation) e.stopPropagation()
      if (node.on?.click) runtime?.handle(node.on.click)
    }
  }
  if (node.element === 'form') {
    props.onSubmit = (e: Event) => {
      e.preventDefault()
      if (node.on?.submit) runtime?.handle(node.on.submit)
    }
  }

  if (node.element === 'input' || node.element === 'img' || node.element === 'hr' || node.element === 'textarea') {
    return h(node.element, props)
  }
  const children: Array<VNode | string> = []
  if (node.text != null && node.text !== '') children.push(node.text)
  for (const c of node.children) children.push(renderSduiNode(c, runtime))
  return h(node.element, props, children)
}

/** Component form of renderSduiNode (for templates). */
export const SduiNodeView = defineComponent({
  name: 'SduiNodeView',
  props: {
    node: { type: Object as PropType<RenderNode>, required: true },
    runtime: { type: Object as PropType<SduiRuntime>, default: undefined }
  },
  setup(props) {
    return () => renderSduiNode(props.node, props.runtime)
  }
})
