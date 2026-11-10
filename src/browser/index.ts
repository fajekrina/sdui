/**
 * @fajekrina/sdui/browser — browser implementations of the core ports.
 * The only module in the package that touches window/document/localStorage/fetch.
 */

import type {
  SduiPorts, StoragePort, NetworkPort, CryptoPort, NavigationPort, EventPort, PageRequest, PageResponse, HttpRequest
} from '../core/ports'
import { memoryStorage, consoleLogger } from '../core/ports'
import { webCryptoVerify } from '../core/sign'

export interface BrowserPortsOptions {
  /** API base, default `/api/universal/v1` (universal-service) */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** request `?signed=true` envelopes from the client endpoint */
  signed?: boolean
  /** extra request headers (auth, tenant, …) */
  headers?: Record<string, string>
}

export function browserStorage(): StoragePort {
  try {
    const ls = window.localStorage
    const probe = '__sdui_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return {
      get: (key) => ls.getItem(key),
      set: (key, value) => { try { ls.setItem(key, value) } catch { /* quota / private mode */ } },
      remove: (key) => ls.removeItem(key)
    }
  } catch {
    return memoryStorage()
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return text }
}

export function browserNetwork(opts: BrowserPortsOptions = {}): NetworkPort {
  const base = (opts.baseUrl ?? '/api/universal/v1').replace(/\/$/, '')
  const doFetch = (input: string, init?: RequestInit) => (opts.fetchImpl ?? fetch)(input, init)
  return {
    async getPage(req: PageRequest): Promise<PageResponse> {
      const url = `${base}/client/page/${encodeURIComponent(req.merchantId)}/${encodeURIComponent(req.pageKey)}${opts.signed ? '?signed=true' : ''}`
      const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) }
      if (req.etag) headers['If-None-Match'] = `"${req.etag}"`
      const res = await doFetch(url, { headers, signal: req.signal })
      const etag = res.headers.get('ETag')?.replace(/^W\//, '').replace(/"/g, '') || undefined
      if (res.status === 304) return { status: 304, etag: etag ?? req.etag }
      return { status: res.status, body: await parseBody(res), etag }
    },
    async request(req: HttpRequest) {
      const res = await doFetch(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers ?? {}) },
        body: req.body === undefined || req.method === 'GET' ? undefined : JSON.stringify(req.body),
        signal: req.signal
      })
      return { status: res.status, body: await parseBody(res) }
    }
  }
}

export const browserCrypto: CryptoPort = { verifyEd25519: webCryptoVerify }

export const browserNavigation: NavigationPort = {
  // no router knowledge: navigate only fires onAction (wire your router via ports.navigation)
  navigate: () => {},
  back: () => window.history.back(),
  openExternal: (href) => { window.open(href, '_blank', 'noopener') }
}

export const browserEvents: EventPort = {
  emit: (name, detail) => { document.dispatchEvent(new CustomEvent(name, { detail })) }
}

/** All ports wired to browser APIs. Override any of them with your own implementation. */
export function browserPorts(opts: BrowserPortsOptions = {}): Required<Omit<SduiPorts, 'logger'>> & Pick<SduiPorts, 'logger'> {
  return {
    storage: browserStorage(),
    network: browserNetwork(opts),
    crypto: browserCrypto,
    navigation: browserNavigation,
    events: browserEvents,
    logger: consoleLogger
  }
}

/** true when running in a browser-like environment (adapters use this to pick defaults) */
export function hasBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}
