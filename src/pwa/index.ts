// @fajekrina/sdui/pwa — the browser side of offline reading and app updates.
// Touches window / navigator; never imported by the core.

import type { ConnectivityPort } from '../ports'

export interface ConnectivityOptions {
  /// optional same-origin URL fetched (HEAD, no-store) to confirm reachability:
  /// `navigator.onLine` alone reports "online" on a captive portal or a dead Wi-Fi
  probeUrl?: string
  /// re-probe interval while subscribed (default 30 s; only with `probeUrl`)
  intervalMs?: number
  /// for tests and non-window hosts
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator: { onLine: boolean } }
  fetchImpl?: typeof fetch
}

/// `ConnectivityPort` from the `online` / `offline` events (plus an optional probe).
/// Pass it to `createEngine({ connectivity })`.
export function connectivity(options: ConnectivityOptions = {}): ConnectivityPort {
  const target = options.target ?? window
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  let probed: boolean | undefined
  const online = () => target.navigator.onLine && probed !== false

  return {
    online,
    subscribe(listener) {
      let last = online()
      const report = () => {
        const now = online()
        if (now !== last) { last = now; listener(now) }
      }
      const probe = async () => {
        if (!options.probeUrl || !target.navigator.onLine) return report()
        try {
          probed = (await doFetch(options.probeUrl, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })).ok
        } catch {
          probed = false
        }
        report()
      }
      const onOnline = () => { probed = undefined; void probe() }
      const onOffline = () => report()
      target.addEventListener('online', onOnline)
      target.addEventListener('offline', onOffline)
      const timer = options.probeUrl ? setInterval(() => void probe(), options.intervalMs ?? 30_000) : undefined
      return () => {
        target.removeEventListener('online', onOnline)
        target.removeEventListener('offline', onOffline)
        if (timer) clearInterval(timer)
      }
    }
  }
}

export interface ServiceWorkerUpdateOptions {
  /// may the new version take over now? e.g. no screen has `hasPendingUpdate`, no
  /// action in flight, no dirty form — never reload under a user mid-task
  canApply: () => boolean
  /// a new app version is installed and waiting; call `apply()` (e.g. from a
  /// "New version — reload" banner). `apply` does nothing while `canApply()` is false.
  onAvailable: (apply: () => void) => void
  /// for tests (default `navigator.serviceWorker`)
  container?: ServiceWorkerContainer
  /// default `location.reload()`
  reload?: () => void
}

/// The "new version available" flow for a Workbox (or any) service worker that
/// skips waiting on `{ type: 'SKIP_WAITING' }`. Returns an unsubscribe.
export function onServiceWorkerUpdate(options: ServiceWorkerUpdateOptions): () => void {
  const container = options.container ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined)
  if (!container) return () => undefined
  const reload = options.reload ?? (() => location.reload())
  let stopped = false
  let applying = false
  const offer = (waiting: ServiceWorker | null | undefined) => {
    if (!waiting || stopped) return
    options.onAvailable(() => {
      if (!options.canApply() || applying) return
      applying = true
      waiting.postMessage({ type: 'SKIP_WAITING' })
    })
  }
  const onControllerChange = () => { if (applying) reload() }
  container.addEventListener('controllerchange', onControllerChange)
  void container.getRegistration().then((registration) => {
    if (!registration || stopped) return
    offer(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      installing?.addEventListener('statechange', () => {
        // installed while a controller exists = an update (not the first install)
        if (installing.state === 'installed' && container.controller) offer(registration.waiting ?? installing)
      })
    })
  })
  return () => {
    stopped = true
    container.removeEventListener('controllerchange', onControllerChange)
  }
}
