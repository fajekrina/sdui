/**
 * Fajrina SDUI — Runtime: the framework-free engine every adapter binds to.
 *
 *   load()   network + verify + cache          (async, never throws)
 *   render() data → RenderNode tree            (pure w.r.t. data + UI state)
 *   handle() event from a RenderNode           (dispatch / submit / closeModal)
 *
 * Adapters only render RenderNodes and forward DOM events to handle().
 */

import type { FajrinaActionEvent, FajrinaData, UniversalComponent, UniversalLayout } from './types'
import { normalizeToLayout } from './types'
import { buildTree } from './tree'
import { resolveThemeTokens, type UniversalTheme } from './theme'
import { validateData, toErrorPage, DEFAULT_BOUNDS, type SduiBounds, type SduiError, type SduiPolicy } from './validate'
import { resolveAction, mergePolicy, checkUrl, validateField, type ResolvedAction, type FieldRule } from './actions'
import { resolvePorts, type ResolvedPorts, type SduiPorts } from './ports'
import { createUiStore, type UiChange, type UiState, type UiStore } from './ui-store'
import { renderComponent, renderOverlays, emptyNode, type RenderNode, type ViewContext } from './view-model'
import { loadPage, type LoadResult, type PageSource, type VerifyOptions } from './loader'

export interface RuntimeOptions {
  ports?: SduiPorts
  theme?: UniversalTheme
  /** app policy = upper bound; the payload policy may only narrow it */
  policy?: SduiPolicy
  /** warn (default): log and render · strict: render the error page on any issue */
  mode?: 'warn' | 'strict'
  bounds?: SduiBounds
  verify?: VerifyOptions
  onAction?: (event: FajrinaActionEvent) => void
  /** dev markers for unknown types (default: NODE_ENV !== 'production') */
  dev?: boolean
}

export interface RenderResult {
  nodes: RenderNode[]
  overlays: RenderNode[]
  errors: SduiError[]
  /** strict mode + errors → nodes are the error page */
  failed: boolean
}

export interface RenderOptions {
  /** false = static preview (builder): no handlers, fields disabled */
  interactive?: boolean
}

export interface SduiRuntime {
  readonly ports: ResolvedPorts
  load(src: PageSource): Promise<LoadResult>
  render(data: FajrinaData, opts?: RenderOptions): RenderResult
  /** handler key from RenderNode.on */
  handle(key: string): void
  dispatch(nodeId: string): Promise<void>
  submit(formId: string): Promise<void>
  getState(): UiState
  subscribe(listener: (change: UiChange) => void): () => void
  setFieldValue(formId: string, name: string, value: string): void
  getOptions(): RuntimeOptions
  setOptions(patch: Partial<RuntimeOptions>): void
  destroy(): void
}

function detectDev(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process
  return proc?.env?.NODE_ENV !== 'production' && proc !== undefined
}

export function createRuntime(initial: RuntimeOptions = {}, fallbackPorts?: SduiPorts): SduiRuntime {
  let options: RuntimeOptions = { ...initial }
  let ports = resolvePorts(options.ports, fallbackPorts)
  const ui: UiStore = createUiStore()
  const index = new Map<string, UniversalComponent>()
  const formRules = new Map<string, FieldRule[]>()
  const warned = new Set<string>()
  const validated = new WeakMap<object, { key: string; errors: SduiError[] }>()
  let currentPolicy: SduiPolicy | undefined = options.policy

  const warnOnce = (msg: string) => {
    if (warned.has(msg)) return
    warned.add(msg)
    ports.logger.warn(msg)
  }

  const optionsKey = () => `${options.mode ?? 'warn'}|${options.theme?.version ?? ''}|${JSON.stringify(options.policy ?? null)}`

  function validateOnce(data: FajrinaData, policy?: SduiPolicy): SduiError[] {
    const key = optionsKey()
    const isObj = data !== null && typeof data === 'object'
    if (isObj) {
      const hit = validated.get(data as object)
      if (hit && hit.key === key) return hit.errors
    }
    const errors = validateData(data, { bounds: options.bounds, policy, theme: options.theme })
    for (const err of errors) ports.logger.warn(`[fajrina-sdui:${err.code}]${err.path ? ` ${err.path}` : ''} — ${err.message}`)
    if (isObj) validated.set(data as object, { key, errors })
    return errors
  }

  function payloadPolicy(data: FajrinaData): SduiPolicy | undefined {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
    const p = (data as Record<string, unknown>).policy
    return p && typeof p === 'object' ? (p as SduiPolicy) : undefined
  }

  function toTree(layout: UniversalLayout): UniversalComponent[] {
    const comps = options.theme ? resolveThemeTokens(layout.components ?? [], options.theme) : (layout.components ?? [])
    return comps.some((c) => c.parentId != null) ? buildTree(comps) : comps
  }

  function render(data: FajrinaData, opts: RenderOptions = {}): RenderResult {
    const interactive = opts.interactive !== false
    const policy = mergePolicy(options.policy, payloadPolicy(data))
    if (interactive) currentPolicy = policy
    const errors = validateOnce(data, policy)
    const failed = options.mode === 'strict' && errors.length > 0
    const source: FajrinaData = failed
      ? toErrorPage(`Blocked ${errors.length} validation issue(s). See console for details.`, { kind: 'blocked', code: errors[0]!.code })
      : data
    const ctx: ViewContext = {
      policy,
      state: ui.getState(),
      interactive,
      dev: options.dev ?? detectDev(),
      logger: { warn: warnOnce, error: (m) => ports.logger.error(m) },
      index: interactive ? index : undefined,
      formRules: interactive ? formRules : undefined
    }
    if (interactive) formRules.set('_standalone', [])
    const layout = normalizeToLayout(source)
    const roots = layout && layout.components && layout.components.length ? toTree(layout) : []
    const nodes = roots.length
      ? roots.map((c) => renderComponent(c, ctx)).filter((n): n is RenderNode => n !== null)
      : [emptyNode()]
    return { nodes, overlays: interactive ? renderOverlays(ctx) : [], errors, failed }
  }

  function makeEvent(action: ResolvedAction, comp: UniversalComponent, data?: Record<string, unknown>): FajrinaActionEvent {
    const ev: FajrinaActionEvent = {
      behavior: action.behavior,
      action: action.behavior,
      target: action.target,
      href: action.href ?? action.url,
      eventName: action.eventName,
      data,
      params: action.params,
      sourceComponent: comp,
      defaultPrevented: false
    }
    ev.preventDefault = () => { ev.defaultPrevented = true }
    return ev
  }

  function blocked(action: ResolvedAction, comp: UniversalComponent, reason: string) {
    ports.logger.warn(`[fajrina-sdui:blocked] ${comp.id} — ${action.behavior}: ${reason}`)
    options.onAction?.({
      behavior: 'blocked', action: 'blocked', target: action.target, params: action.params,
      data: { reason, behavior: action.behavior }, sourceComponent: comp
    })
  }

  async function run(action: ResolvedAction | undefined, comp: UniversalComponent, data: Record<string, unknown> | undefined, depth: number): Promise<void> {
    if (!action) return
    const max = options.bounds?.maxChainDepth ?? DEFAULT_BOUNDS.maxChainDepth ?? 4
    if (depth > max) { blocked(action, comp, `chain depth exceeds ${max}`); return }
    if (action.legacy.length) warnOnce(`[fajrina-sdui:deprecated] ${comp.id} uses legacy action shape (${action.legacy.join(', ')}); use props.action { behavior, … } — removed in 1.0`)

    const policy = currentPolicy
    if (action.behavior === 'externalLink') {
      const check = checkUrl(action.href, policy)
      if (!check.ok) return blocked(action, comp, check.reason)
    }
    if (action.behavior === 'api') {
      const check = checkUrl(action.url, policy)
      if (!check.ok) return blocked(action, comp, check.reason)
    }
    if (action.behavior === 'customEvent' && policy?.allowedEvents && !policy.allowedEvents.includes(action.eventName ?? '')) {
      return blocked(action, comp, `event '${action.eventName ?? ''}' not in policy allowedEvents`)
    }

    const ev = makeEvent(action, comp, data)
    options.onAction?.(ev)
    if (ev.defaultPrevented) return

    switch (action.behavior) {
      case 'navigate':
        if (action.target) ports.navigation.navigate(action.target, action.params)
        break
      case 'back':
        ports.navigation.back()
        break
      case 'externalLink':
        if (action.href) ports.navigation.openExternal(action.href)
        break
      case 'toast':
        ui.showToast(action.message ?? 'Toast')
        break
      case 'openModal':
        ui.openModal({ id: action.modalId ?? comp.id, title: action.title, message: action.message })
        break
      case 'closeModal':
        ui.closeModal()
        break
      case 'customEvent':
        if (action.eventName) {
          ports.events.emit(action.eventName, action.params)
          ui.showToast(`Event ${action.eventName} dispatched`)
        }
        break
      case 'api': {
        if (!ports.network?.request) { blocked(action, comp, 'no NetworkPort.request configured'); return }
        let ok = false
        let body: unknown
        try {
          const res = await ports.network.request({ method: action.method ?? 'POST', url: action.url!, body: action.body ?? data })
          ok = res.status >= 200 && res.status < 300
          body = res.body
        } catch (e) {
          body = { error: String((e as Error).message ?? e) }
        }
        const next = ok ? action.onSuccess : action.onError
        const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : { value: body }
        await run(next, comp, payload, depth + 1)
        break
      }
      default:
        // submit and unknown behaviors: the app handles them in onAction
        break
    }
  }

  async function dispatch(nodeId: string): Promise<void> {
    const comp = index.get(nodeId)
    if (!comp) return
    const action = resolveAction(comp)
    if (action) await run(action, comp, undefined, 1)
  }

  async function submit(formId: string): Promise<void> {
    const comp = index.get(formId)
    if (!comp) return
    const values = { ...(ui.getState().forms[formId]?.values ?? {}) }
    const errors: Record<string, string> = {}
    for (const rule of formRules.get(formId) ?? []) {
      const err = validateField(rule, values[rule.name])
      if (err) errors[rule.name] = err
    }
    ui.setErrors(formId, errors)
    const missing = Object.keys(errors)
    if (missing.length) {
      options.onAction?.({
        behavior: 'validationError', action: 'validationError',
        data: { fields: missing, errors }, params: {}, sourceComponent: comp
      })
      return
    }
    const action = resolveAction(comp) ?? { behavior: 'submit', legacy: [] }
    await run(action, comp, values, 1)
  }

  return {
    get ports() { return ports },
    load: (src) => loadPage(src, { ports, verify: options.verify, bounds: options.bounds, policy: options.policy }),
    render,
    handle(key) {
      const i = key.indexOf(':')
      const kind = i === -1 ? key : key.slice(0, i)
      const arg = i === -1 ? '' : key.slice(i + 1)
      if (kind === 'dispatch') void dispatch(arg)
      else if (kind === 'submit') void submit(arg)
      else if (kind === 'closeModal') ui.closeModal()
    },
    dispatch,
    submit,
    getState: () => ui.getState(),
    subscribe: (listener) => ui.subscribe(listener),
    setFieldValue: (formId, name, value) => ui.setField(formId, name, value),
    getOptions: () => options,
    setOptions(patch) {
      options = { ...options, ...patch }
      if (patch.ports) ports = resolvePorts(options.ports, fallbackPorts)
      if (patch.policy !== undefined) currentPolicy = patch.policy
    },
    destroy() { ui.destroy(); index.clear(); formRules.clear() }
  }
}
