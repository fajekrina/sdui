/**
 * @fajekrina/sdui/vanilla — DOM adapter without a framework.
 * Renders RenderNodes with document.createElement; text is always textContent.
 */
import type { FajrinaData } from '../core/types'
import type { RenderNode } from '../core/view-model'
import type { LoadResult } from '../core/loader'
import { createRuntime, type RuntimeOptions, type SduiRuntime } from '../core/runtime'
import { browserPorts } from '../browser'

export interface MountOptions extends RuntimeOptions {
  data?: FajrinaData
  source?: { merchantId: string; pageKey: string }
  onLoad?: (result: LoadResult) => void
  /** share a runtime with other mounts */
  runtime?: SduiRuntime
}

export interface MountedView {
  readonly runtime: SduiRuntime
  update(data: FajrinaData): void
  reload(): Promise<LoadResult | null>
  destroy(): void
}

export function createElementFromNode(node: RenderNode, runtime?: SduiRuntime): HTMLElement {
  const el = document.createElement(node.element)
  for (const [k, v] of Object.entries(node.style)) {
    if (k.startsWith('--')) el.style.setProperty(k, v)
    else (el.style as unknown as Record<string, string>)[k] = v
  }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'value' && node.element !== 'option') continue
    el.setAttribute(k, v === true ? '' : String(v))
  }
  if (node.text != null && node.text !== '') el.appendChild(document.createTextNode(node.text))
  for (const c of node.children) el.appendChild(createElementFromNode(c, runtime))

  if (node.field && runtime) {
    const { formId, name } = node.field
    const control = el as HTMLInputElement
    control.value = String(node.attrs.value ?? '')
    control.addEventListener(node.element === 'select' ? 'change' : 'input', () => runtime.setFieldValue(formId, name, control.value))
  }
  if (node.on?.click || node.stopPropagation || (node.preventDefault && node.element === 'a')) {
    el.addEventListener('click', (e) => {
      if (node.preventDefault) e.preventDefault()
      if (node.stopPropagation) e.stopPropagation()
      if (node.on?.click) runtime?.handle(node.on.click)
    })
  }
  if (node.element === 'form') {
    el.addEventListener('submit', (e) => {
      e.preventDefault()
      if (node.on?.submit) runtime?.handle(node.on.submit)
    })
  }
  return el
}

export function mount(target: HTMLElement, options: MountOptions = {}): MountedView {
  const { data: initialData, source, onLoad, runtime: shared, ...runtimeOptions } = options
  const rt = shared ?? createRuntime(runtimeOptions, browserPorts())
  let data: FajrinaData = initialData
  let loading = data === undefined && !!source
  const root = document.createElement('div')
  target.appendChild(root)

  const paint = () => {
    root.replaceChildren()
    if (loading) { root.setAttribute('aria-busy', 'true'); return }
    root.removeAttribute('aria-busy')
    const result = rt.render(data)
    for (const n of [...result.nodes, ...result.overlays]) root.appendChild(createElementFromNode(n, rt))
  }
  // a field change is already in the DOM: repainting would steal focus
  const unsubscribe = rt.subscribe((change) => { if (change !== 'field') paint() })

  const reload = async (): Promise<LoadResult | null> => {
    if (!source) return null
    const r = await rt.load(source)
    data = r.page
    loading = false
    paint()
    onLoad?.(r)
    return r
  }

  paint()
  if (loading) void reload()

  return {
    runtime: rt,
    update(next) { data = next; loading = false; paint() },
    reload,
    destroy() {
      unsubscribe()
      root.remove()
      if (!shared) rt.destroy()
    }
  }
}

export * from '../core'
export { browserPorts } from '../browser'
