// @fajekrina/sdui/bridge — the web side of the native bridge.
//
// Inside an Android WebView or iOS WKWebView the app is only a HOST: it loads the
// same web bundle and answers named, allow-listed messages. Never `eval`, never
// `addJavascriptInterface`, never a file URL:
//
//   Android  WebViewCompat.addWebMessageListener(webView, "sduiHost", allowedOrigins, …)
//            → `window.sduiHost.postMessage(json)`; replies arrive on `window.sduiHost.onmessage`
//   iOS      WKUserContentController.add(handler, name: "sdui")
//            → `window.webkit.messageHandlers.sdui.postMessage(json)`;
//            replies via `webView.evaluateJavaScript("window.sduiBridge.receive(<json>)")`
//
// One protocol for both:
//   web → host  { v: 1, id: "r-42", method: "navigator.navigate", params: { … } }
//   host → web  { v: 1, id: "r-42", ok: true, result: … } | { v: 1, id, ok: false, error: "…" }
//               { v: 1, event: "host.back" } | { v: 1, event: "host.theme", data: { … } }

import { SduiError } from '../core/errors'
import type { HostPort, Navigator, ViewportPort } from '../ports'
import type { SduiProps, SduiValue } from '../core/value'
import type { SduiEvent } from '../core/events'

export const BRIDGE_VERSION = 1

/// The host methods the web side calls. A host implements exactly these.
export type BridgeMethod =
  | 'host.info'
  | 'navigator.navigate' | 'navigator.dismiss' | 'navigator.refresh' | 'navigator.openLink'
  | 'auth.token'
  | 'native.command'
  | 'events.track'

export type HostKind = 'android' | 'ios' | 'browser'

export interface BridgeRequest { v: number; id: string; method: BridgeMethod; params?: Record<string, unknown> }
export type BridgeResponse =
  | { v: number; id: string; ok: true; result?: unknown }
  | { v: number; id: string; ok: false; error?: string }
export interface BridgeEvent { v: number; event: string; data?: Record<string, unknown> }

/// How messages travel; injectable so tests and custom hosts can supply their own.
export interface BridgeTransport {
  post(message: string): void
  /// install the inbound handler (host → web)
  listen(onMessage: (message: string) => void): void
}

interface AndroidHostObject { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null }
type BridgeWindow = Window & {
  sduiHost?: AndroidHostObject
  webkit?: { messageHandlers?: { sdui?: { postMessage(message: string): void } } }
  sduiBridge?: { receive(message: string): void }
}

/// Which host the bundle runs in — decided once, here; the engine never knows.
export function detectHost(win: BridgeWindow | undefined = typeof window !== 'undefined' ? (window as BridgeWindow) : undefined): HostKind {
  if (!win) return 'browser'
  if (win.sduiHost && typeof win.sduiHost.postMessage === 'function') return 'android'
  if (win.webkit?.messageHandlers?.sdui) return 'ios'
  return 'browser'
}

/// The platform transport for the detected host, or `undefined` in a browser.
export function platformTransport(win: BridgeWindow = window as BridgeWindow): BridgeTransport | undefined {
  switch (detectHost(win)) {
    case 'android': {
      const host = win.sduiHost!
      return {
        post: (m) => host.postMessage(m),
        listen: (on) => { host.onmessage = (event) => on(String(event.data)) }
      }
    }
    case 'ios': {
      const handler = win.webkit!.messageHandlers!.sdui!
      return {
        post: (m) => handler.postMessage(m),
        listen: (on) => { win.sduiBridge = { receive: (m) => on(typeof m === 'string' ? m : JSON.stringify(m)) } }
      }
    }
    default:
      return undefined
  }
}

/// Request/response correlation + host events over a transport.
export class Bridge {
  private seq = 0
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly listeners = new Map<string, Set<(data: Record<string, unknown>) => void>>()

  constructor(private readonly transport: BridgeTransport, private readonly timeoutMs = 15000, private readonly onError?: (method: string, message: string) => void) {
    transport.listen((raw) => this.receive(raw))
  }

  call<T = unknown>(method: BridgeMethod, params?: Record<string, unknown>): Promise<T> {
    const id = `r-${++this.seq}`
    const message: BridgeRequest = { v: BRIDGE_VERSION, id, method, params }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.onError?.(method, 'timeout')
        reject(new Error(`bridge ${method} timed out`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.transport.post(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        this.onError?.(method, String(error))
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /// Fire-and-forget (no reply expected).
  notify(method: BridgeMethod, params?: Record<string, unknown>): void {
    void this.call(method, params).catch(() => {})
  }

  on(event: string, listener: (data: Record<string, unknown>) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return () => set.delete(listener)
  }

  private receive(raw: string): void {
    let message: Partial<BridgeResponse & BridgeEvent>
    try { message = JSON.parse(raw) } catch { return }
    if (message.v !== BRIDGE_VERSION) return
    if (typeof message.event === 'string') {
      this.listeners.get(message.event)?.forEach((l) => l(message.data ?? {}))
      return
    }
    if (typeof message.id !== 'string') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.ok) pending.resolve((message as { result?: unknown }).result)
    else {
      const error = (message as { error?: string }).error ?? 'host error'
      this.onError?.('reply', error)
      pending.reject(new Error(error))
    }
  }
}

export interface NativeBridgePorts {
  bridge: Bridge
  navigator: Navigator
  host: HostPort
  /// token pattern B: a short-lived access token from the host, memory only
  getHeaders(options: { refresh: boolean }): Promise<Record<string, string>>
  viewport: ViewportPort
  /// forward observability events to native analytics
  onEvent(event: SduiEvent): void
  /// subscribe to host events (`host.back`, `host.theme`, …)
  onHostEvent(event: string, listener: (data: Record<string, unknown>) => void): () => void
}

/// Ports backed by the native host. Commands the host doesn't support reject,
/// so the payload's `onError` runs.
export function nativeBridgePorts(options: { transport?: BridgeTransport; timeoutMs?: number } = {}): NativeBridgePorts {
  const transport = options.transport ?? platformTransport()
  if (!transport) throw new Error('nativeBridgePorts: no native host detected (use browserPorts in a browser)')
  const errors: Array<(method: string, message: string) => void> = []
  const bridge = new Bridge(transport, options.timeoutMs, (method, message) => errors.forEach((e) => e(method, message)))

  let token: { headers: Record<string, string> } | undefined
  let width = typeof window !== 'undefined' ? window.innerWidth : 0
  const widthListeners = new Set<() => void>()
  bridge.on('host.viewport', (data) => {
    if (typeof data.width === 'number') { width = data.width; widthListeners.forEach((l) => l()) }
  })

  return {
    bridge,
    navigator: {
      navigate: (screen, params, { presentation }) => bridge.notify('navigator.navigate', { screen, params, presentation }),
      dismiss: () => bridge.notify('navigator.dismiss'),
      refresh: () => bridge.notify('navigator.refresh'),
      openLink: (name) => bridge.notify('navigator.openLink', { name })
    },
    host: {
      async native(command: string, params: SduiProps): Promise<SduiValue> {
        try {
          return (await bridge.call<SduiValue>('native.command', { command, params })) ?? null
        } catch {
          throw SduiError.unknownCommand(command)
        }
      }
    },
    async getHeaders({ refresh }) {
      if (!token || refresh) {
        const result = await bridge.call<{ accessToken?: string }>('auth.token', { refresh })
        token = result?.accessToken ? { headers: { Authorization: `Bearer ${result.accessToken}` } } : { headers: {} }
      }
      return token.headers
    },
    viewport: {
      width: () => width,
      subscribe: (listener) => { widthListeners.add(listener); return () => widthListeners.delete(listener) }
    },
    onEvent(event) { bridge.notify('events.track', { event: event as unknown as Record<string, unknown> }) },
    onHostEvent: (event, listener) => bridge.on(event, listener)
  }
}

/// Apply a host theme (`host.theme` → `{ colors: { primary: "#…" } }`) as the
/// `--sdui-color-*` CSS variables the semantic color tokens resolve to.
export function applyTheme(colors: Record<string, unknown>, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(colors)) {
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(name) && typeof value === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(value)) {
      root.style.setProperty(`--sdui-color-${name}`, value)
    }
  }
}

export { verifyBundleManifest, type BundleManifest } from './bundle-manifest'
