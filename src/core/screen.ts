import { DataContext } from './data-context'
import { RenderContext, type RenderEnvironment } from './render-context'
import { createUiStore, type UiStore } from './ui-store'
import { renderNode, type RenderNode, type RenderResult } from './render-node'
import { MESSAGES_EN, validateField, type FieldRule } from './patterns'
import { resolveValue } from './token'
import { SduiValue, type SduiProps } from './value'
import { parseJSON } from './payload'
import { ERROR_TITLES, errorKindOf, type SduiError } from './errors'
import { color } from './style'
import { Symbols } from './components/symbols'
import { NamedRequest, COMPACT_MAX_WIDTH } from '../ports'
import type { ActionContext } from './actions/dispatcher'
import type { ActionSpec } from './actions/spec'
import type { SduiEngine, LoadState, ScreenSource } from './engine'
import type { SduiNode } from './node'

export interface RenderOptions {
  /// false = static preview (builder): no handlers, fields disabled
  interactive?: boolean
  /// toolkit-specific component types the adapter renders itself
  slots?: Iterable<string>
}

interface Handler {
  action: ActionSpec
  data: DataContext
  formId?: string
}

/// One screen's lifecycle: load (verify + validate + cache) → `screen.load`
/// requests in parallel → render to RenderNodes → handle clicks and field input.
/// Adapters (React, Vue, vanilla) only subscribe and render what it returns.
export class ScreenController {
  readonly data: DataContext
  readonly ui: UiStore
  private state: LoadState = { kind: 'loading' }
  private version = 0
  private readonly listeners = new Set<() => void>()
  private handlers = new Map<string, Handler>()
  private fieldRules = new Map<string, FieldRule[]>()
  private pendingLoads = 0
  private abort?: AbortController
  private readonly unsubscribers: Array<() => void> = []
  private loadToken = 0
  /// actions in flight: handler keys and `form:<id>` locks (double-tap guard)
  private readonly inFlight = new Set<string>()
  private tapSeq = 0

  constructor(readonly engine: SduiEngine, readonly source: ScreenSource, seed: Record<string, SduiValue> = {}) {
    this.data = new DataContext(seed)
    this.ui = createUiStore()
    this.unsubscribers.push(this.data.subscribe(() => this.changed()))
    this.unsubscribers.push(this.ui.subscribe(() => this.changed()))
    const viewport = engine.viewport?.subscribe?.(() => this.changed())
    if (viewport) this.unsubscribers.push(viewport)
  }

  get loadState(): LoadState { return this.state }

  /// Monotonic change counter — the snapshot for `useSyncExternalStore`.
  getSnapshot = (): number => this.version

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private changed(): void {
    this.version++
    for (const listener of [...this.listeners]) listener()
  }

  /// Load (or reload) the source; then run `screen.load` requests in parallel.
  async load(): Promise<LoadState> {
    const token = ++this.loadToken
    this.abort?.abort()
    this.abort = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    this.state = { kind: 'loading' }
    this.changed()
    const next = await this.engine.load(this.source, {
      signal: this.abort?.signal,
      // stale-while-revalidate: a newer screen replaces the cached one in place
      onUpdate: (screen) => {
        if (token !== this.loadToken) return
        this.state = { kind: 'loaded', screen, origin: 'network' }
        this.changed()
      }
    })
    if (token !== this.loadToken) return next
    this.state = next
    this.changed()
    if (next.kind === 'loaded' && next.screen.load.length > 0) void this.runLoads(next.screen.load, token)
    return next
  }

  private async runLoads(requests: Array<{ request: string; params?: SduiProps }>, token: number): Promise<void> {
    this.pendingLoads += requests.length
    this.data.merge({ $load: Object.fromEntries(requests.map((r) => [r.request, 'pending'])) })
    await Promise.all(requests.map(async ({ request, params }) => {
      const started = Date.now()
      let status: 'ok' | 'error' = 'ok'
      try {
        const resolved = params ? (resolveValue(params, (k) => this.data.value(k)) as SduiProps) : {}
        const bytes = await this.engine.actionDispatcher.network.perform(new NamedRequest(request), resolved, { signal: this.abort?.signal })
        if (token !== this.loadToken) return
        try { this.data.merge({ [request]: SduiValue.decode(parseJSON(bytes)) }) } catch { /* non-JSON: nothing to merge */ }
      } catch {
        status = 'error'
      } finally {
        if (token === this.loadToken) {
          this.pendingLoads--
          const loads = SduiValue.objectValue(this.data.get('$load')) ?? {}
          this.data.merge({ $load: { ...loads, [request]: status } })
          this.engine.emit({ type: 'load_request', request, ok: status === 'ok', ms: Date.now() - started })
        }
      }
    }))
  }

  /// The tree for the current state: the screen (or its width variant), a
  /// loading indicator, or the fail-closed error view; toasts as overlays.
  render(options: RenderOptions = {}): RenderResult {
    const interactive = options.interactive ?? true
    this.handlers = new Map()
    this.fieldRules = new Map()
    const ui = this.ui.getState()
    if (this.state.kind === 'loading') return { nodes: [loadingView()], overlays: [] }
    if (this.state.kind === 'failed') return { nodes: [errorView(this.state.error, this.engine.debug)], overlays: [] }

    const env: RenderEnvironment = {
      factory: this.engine.componentFactory,
      ui,
      interactive,
      debug: this.engine.debug,
      loading: this.pendingLoads > 0,
      assetURL: this.engine.assetURL,
      slots: new Set(options.slots ?? []),
      busy: (key, formId) => this.inFlight.has(key) || (formId !== undefined && this.inFlight.has(`form:${formId}`)),
      sink: {
        bindAction: (key, action, data, formId) => {
          this.handlers.set(key, { action, data, formId })
          return key
        },
        registerField: (formId, rule) => {
          const rules = this.fieldRules.get(formId) ?? []
          rules.push(rule)
          this.fieldRules.set(formId, rules)
        },
        unknownComponent: (componentType) => this.engine.emit({ type: 'unknown_component', componentType })
      }
    }
    const root = this.pickRoot(this.state.screen)
    const view = new RenderContext(this.data, env).view(root)
    return { nodes: view ? [view] : [], overlays: ui.toasts.map(toastView) }
  }

  /// The layout for the current width: a variant when one fits, else `root`.
  private pickRoot(screen: { root: SduiNode; variants: { compact?: SduiNode; wide?: SduiNode } }): SduiNode {
    const width = this.engine.viewport?.width()
    if (width === undefined) return screen.root
    if (width < COMPACT_MAX_WIDTH) return screen.variants.compact ?? screen.root
    return screen.variants.wide ?? screen.root
  }

  /// A field changed (adapters call this from input events).
  setFieldValue(formId: string, name: string, value: string): void {
    this.ui.setField(formId, name, value)
  }

  /// A click on a RenderNode handler key. Inside a form, the form's fields are
  /// validated first; the action only runs when they all pass.
  ///
  /// Double-tap guard: while a handler's action chain runs (and, inside a form,
  /// while any of that form's actions runs) further taps are ignored and the
  /// button renders disabled + `aria-busy`.
  async handle(key: string): Promise<void> {
    const handler = this.handlers.get(key)
    if (!handler) return
    const formLock = handler.formId ? `form:${handler.formId}` : undefined
    if (this.inFlight.has(key) || (formLock && this.inFlight.has(formLock))) return
    let data = handler.data
    if (handler.formId) {
      const formId = handler.formId
      const values = this.ui.getState().forms[formId]?.values ?? {}
      const errors: Record<string, string> = {}
      for (const rule of this.fieldRules.get(formId) ?? []) {
        const error = validateField(rule, values[rule.name] ?? '', this.engine.messages)
        if (error) errors[rule.name] = error
      }
      this.ui.setErrors(formId, errors)
      if (Object.keys(errors).length > 0) {
        this.engine.emit({ type: 'form_invalid', formId, fields: Object.keys(errors) })
        return
      }
      data = new DataContext({ ...handler.data.snapshot, form: values })
      // results merged during the chain (api/native) must reach the screen data too
      const original = data.merge.bind(data)
      data.merge = (v) => { original(v); this.data.merge(v) }
    }
    this.inFlight.add(key)
    if (formLock) this.inFlight.add(formLock)
    this.changed()
    try {
      await this.dispatch(handler.action, data, `${Date.now().toString(36)}-${(++this.tapSeq).toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
    } finally {
      this.inFlight.delete(key)
      if (formLock) this.inFlight.delete(formLock)
      this.changed()
    }
  }

  /// Run an action against this screen's data (also used by hosts: e.g. the
  /// Android back button dispatches `{ type: 'dismiss' }`).
  dispatch(action: ActionSpec, data: DataContext = this.data, idempotencyKey?: string): Promise<void> {
    const dispatcher = this.engine.actionDispatcher
    const context: ActionContext = {
      data,
      idempotencyKey,
      network: dispatcher.network,
      navigator: dispatcher.navigator,
      host: dispatcher.host,
      toast: (message, level) => this.ui.showToast(message, level),
      refresh: () => { void this.load() },
      emit: (event) => this.engine.emit(event)
    }
    return dispatcher.dispatch(action, context)
  }

  /// Stop an in-flight load (the controller stays usable; `load()` again later).
  cancel(): void {
    this.loadToken++
    this.abort?.abort()
  }

  destroy(): void {
    this.loadToken++
    this.abort?.abort()
    this.ui.destroy()
    this.unsubscribers.forEach((u) => u())
    this.listeners.clear()
  }
}

// MARK: - System views

function loadingView(): RenderNode {
  return renderNode('sdui:loading', 'div', {
    attrs: { role: 'progressbar', 'aria-busy': 'true', 'aria-label': 'Loading' },
    style: { display: 'flex', justifyContent: 'center', padding: '24px', color: color('muted')! },
    text: '…'
  })
}

/// The fail-closed error surface: a title by error kind, details only in debug.
export function errorView(error: SduiError, debug: boolean): RenderNode {
  const children: RenderNode[] = [
    Symbols.node('sdui:error:icon', 'exclamationmark.triangle'),
    renderNode('sdui:error:title', 'span', { style: { fontSize: '17px', fontWeight: '600' }, text: ERROR_TITLES[errorKindOf(error)] })
  ]
  if (debug) children.push(renderNode('sdui:error:detail', 'span', { style: { fontSize: '12px', color: color('muted')! }, text: error.message }))
  return renderNode('sdui:error', 'div', {
    attrs: { role: 'alert', 'data-sdui-error': error.kind },
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '24px', textAlign: 'center' },
    children
  })
}

const TOAST_COLORS: Record<string, string> = { info: 'onSurface', success: 'success', warning: 'warning', error: 'danger' }

function toastView(toast: { id: string; message: string; level: string }, index: number): RenderNode {
  return renderNode(`toast:${toast.id}`, 'div', {
    attrs: { role: toast.level === 'error' ? 'alert' : 'status', 'data-sdui-toast': toast.level },
    style: {
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: `${16 + index * 52}px`, zIndex: '1000',
      maxWidth: '90vw', padding: '10px 16px', borderRadius: '10px', fontSize: '14px',
      background: color(TOAST_COLORS[toast.level] ?? 'onSurface')!, color: '#FFFFFF', boxShadow: '0 4px 16px rgba(0,0,0,.2)'
    },
    text: toast.message
  })
}

export type { ScreenSource }
