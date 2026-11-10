/**
 * Fajrina SDUI — Vue adapter (thin view binding).
 * All decisions (validation, style, actions, form state, toast/modal) live in
 * the core runtime; this component only subscribes to it and renders RenderNodes.
 */
import { defineComponent, h, onBeforeUnmount, shallowRef, watch, type PropType } from 'vue'
import type { FajrinaData, FajrinaActionEvent } from '../core/types'
import type { SduiPolicy, SduiBounds } from '../core/validate'
import type { UniversalTheme } from '../core/theme'
import type { SduiPorts } from '../core/ports'
import type { LoadResult, VerifyOptions } from '../core/loader'
import { createRuntime, type RuntimeOptions, type SduiRuntime } from '../core/runtime'
import { browserPorts, hasBrowser } from '../browser'
import { renderSduiNode } from './SduiNode'

/** Create a runtime with browser ports as the default on the client. Call destroy() when done. */
export function createSduiRuntime(options: RuntimeOptions = {}): SduiRuntime {
  return createRuntime(options, hasBrowser() ? browserPorts() : undefined)
}

/** Composable: a runtime bound to the current component's lifetime. */
export function useSduiRuntime(options: RuntimeOptions = {}): SduiRuntime {
  const rt = createSduiRuntime(options)
  onBeforeUnmount(() => rt.destroy())
  return rt
}

export const Fajrina = defineComponent({
  name: 'Fajrina',
  props: {
    data: { type: [Object, Array] as PropType<FajrinaData>, default: undefined },
    source: { type: Object as PropType<{ merchantId: string; pageKey: string }>, default: undefined },
    /** warn = log only (default); strict = fail closed, render the error page instead */
    mode: { type: String as PropType<'warn' | 'strict'>, default: 'warn' },
    /** app policy — upper bound; the payload policy may only narrow it */
    policy: { type: Object as PropType<SduiPolicy>, default: undefined },
    theme: { type: Object as PropType<UniversalTheme>, default: undefined },
    bounds: { type: Object as PropType<SduiBounds>, default: undefined },
    ports: { type: Object as PropType<SduiPorts>, default: undefined },
    verify: { type: Object as PropType<VerifyOptions>, default: undefined },
    runtime: { type: Object as PropType<SduiRuntime>, default: undefined }
  },
  emits: {
    action: (_e: FajrinaActionEvent) => true,
    validationError: (_errors: Array<{ field: string; message?: string }>) => true,
    load: (_r: LoadResult) => true
  },
  setup(props, { emit }) {
    const onAction = (e: FajrinaActionEvent) => {
      emit('action', e)
      if (e.behavior === 'validationError') {
        const errors = ((e.data?.errors ?? {}) as Record<string, string>)
        emit('validationError', Object.keys(errors).map((field) => ({ field, message: errors[field] })))
      }
    }
    const own = props.runtime ? null : createSduiRuntime({
      mode: props.mode, policy: props.policy, theme: props.theme, bounds: props.bounds,
      ports: props.ports, verify: props.verify, onAction
    })
    const rt: SduiRuntime = props.runtime ?? own!

    watch(() => [props.mode, props.policy, props.theme, props.bounds, props.verify] as const, ([mode, policy, theme, bounds, verify]) => {
      own?.setOptions({ mode, policy, theme, bounds, verify })
    })
    watch(() => props.ports, (ports) => own?.setOptions({ ports }))

    const state = shallowRef(rt.getState())
    const unsubscribe = rt.subscribe(() => { state.value = rt.getState() })

    const loaded = shallowRef<LoadResult | null>(null)
    let ac: AbortController | undefined
    watch(() => [props.source?.merchantId, props.source?.pageKey] as const, async ([mid, key]) => {
      if (!mid || !key) return
      ac?.abort()
      ac = typeof AbortController !== 'undefined' ? new AbortController() : undefined
      const signal = ac?.signal
      const r = await rt.load({ merchantId: mid, pageKey: key, signal })
      if (signal?.aborted) return
      loaded.value = r
      emit('load', r)
    }, { immediate: true })

    onBeforeUnmount(() => {
      unsubscribe()
      ac?.abort()
      own?.destroy()
    })

    return () => {
      void state.value // re-render on UI state changes
      if (props.data === undefined && props.source && !loaded.value) return h('div', { 'aria-busy': 'true' })
      const result = rt.render(props.data !== undefined ? props.data : loaded.value?.page)
      return h('div', {}, [
        ...result.nodes.map((n) => renderSduiNode(n, rt)),
        ...result.overlays.map((n) => renderSduiNode(n, rt))
      ])
    }
  }
})

export default Fajrina
