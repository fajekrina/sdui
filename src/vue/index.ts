// @fajekrina/sdui/vue — the Vue renderer (thin, generic).
import { defineComponent, h, onBeforeUnmount, shallowRef, watch, type PropType, type VNode } from 'vue'
import { ScreenSource, type LoadState, type SduiEngine } from '../core/engine'
import type { ScreenController } from '../core/screen'
import type { RenderNode } from '../core/render-node'
import type { SduiValue } from '../core/value'
import type { BytesLike } from '../core/bytes'

export type ScreenSourceInput = ScreenSource | { key: string } | { named: string } | { payload: BytesLike | object }
/// Toolkit-specific components: `{ chart: (slot) => h(Chart, …) }`.
export type VueSlots = Record<string, (slot: NonNullable<RenderNode['slot']>, node: RenderNode) => VNode | VNode[] | string>

const SVG_NS = new Set(['svg', 'path'])

export function toScreenSource(input: ScreenSourceInput): ScreenSource {
  if ('kind' in input) return input as ScreenSource
  if ('key' in input) return ScreenSource.key(input.key)
  if ('named' in input) return ScreenSource.named(input.named)
  return ScreenSource.inline(input.payload)
}

/// Render one RenderNode (and its subtree) as a VNode.
export function renderNodeVNode(node: RenderNode, screen?: ScreenController, slots?: VueSlots): VNode {
  if (node.slot && slots?.[node.slot.type]) {
    return h('div', { key: node.key, style: node.style, 'data-sdui-slot': node.slot.type }, [slots[node.slot.type]!(node.slot, node)].flat())
  }
  const props: Record<string, unknown> = { key: node.key, style: node.style }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    props[k] = v
  }
  if (node.field && screen) {
    const { formId, name } = node.field
    props.value = String(node.attrs.value ?? '')
    const handler = (e: Event) => screen.setFieldValue(formId, name, (e.target as HTMLInputElement).value)
    if (node.element === 'select') props.onChange = handler
    else props.onInput = handler
  }
  if (node.on?.click && screen) {
    const key = node.on.click
    props.onClick = (e: Event) => { e.preventDefault(); void screen.handle(key) }
  }
  if (node.element === 'form') props.onSubmit = (e: Event) => e.preventDefault()
  if (node.element === 'input' || node.element === 'img' || node.element === 'hr' || node.element === 'textarea') {
    return h(node.element, props)
  }
  const children: Array<VNode | string> = []
  if (node.text != null && node.text !== '') children.push(node.text)
  for (const c of node.children) children.push(renderNodeVNode(c, screen, slots))
  return SVG_NS.has(node.element) ? h(node.element, props, children) : h(node.element, props, children)
}

/// `<SduiScreen :engine="engine" :source="{ key: 'home' }" />`
export const SduiScreen = defineComponent({
  name: 'SduiScreen',
  props: {
    engine: { type: Object as PropType<SduiEngine>, required: true },
    source: { type: Object as PropType<ScreenSourceInput>, required: true },
    seed: { type: Object as PropType<Record<string, SduiValue>>, default: undefined },
    interactive: { type: Boolean, default: true },
    slots: { type: Object as PropType<VueSlots>, default: undefined }
  },
  emits: { state: (_state: LoadState) => true },
  setup(props, { emit }) {
    const screen = shallowRef<ScreenController>()
    const version = shallowRef(0)
    let unsubscribe: (() => void) | undefined

    const mount = () => {
      unsubscribe?.()
      screen.value?.destroy()
      const next = props.engine.screen(toScreenSource(props.source), { seed: props.seed })
      unsubscribe = next.subscribe(() => {
        version.value = next.getSnapshot()
        emit('state', next.loadState)
      })
      screen.value = next
      void next.load()
    }
    watch(
      () => [props.engine, ScreenSource.identity(toScreenSource(props.source)), JSON.stringify(props.seed ?? {})],
      mount,
      { immediate: true }
    )
    onBeforeUnmount(() => { unsubscribe?.(); screen.value?.destroy() })

    return () => {
      void version.value
      const s = screen.value
      if (!s) return h('div')
      const result = s.render({ interactive: props.interactive, slots: props.slots ? Object.keys(props.slots) : undefined })
      return h('div', { 'data-sdui-screen': ScreenSource.identity(s.source) }, [
        ...result.nodes.map((n) => renderNodeVNode(n, s, props.slots)),
        ...result.overlays.map((n) => renderNodeVNode(n, s, props.slots))
      ])
    }
  }
})

export default SduiScreen
